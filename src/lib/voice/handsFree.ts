// Pure, testable helpers for the hands-free voice pipeline. No DOM, no network.
// (The VAD wiring + getUserMedia live in the client component; these are the
// tunables and the audio encoding so they can be unit-tested without a mic.)

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

/**
 * Silero VAD tuning (@ricky0123/vad-web). Deliberately errs toward WAITING LONGER
 * before ending a turn — this is an emotional-support app; people pause to think,
 * breathe, or get emotional and must NOT be cut off mid-sentence.
 */
export const VAD_TUNING = {
  model: 'v5' as const,
  // Silence (below negativeSpeechThreshold) must persist this long before the turn
  // ends and auto-sends. Tuned LONG on purpose: this is an emotional-support app and
  // people pause mid-sentence to think, breathe, or cry — better to wait an extra beat
  // than cut a grieving man off. ~2.2s. (Tradeoff: a slightly longer beat of quiet
  // before Marcus replies. If it still clips, raise toward 2600; if it feels laggy,
  // ease toward 2000.)
  redemptionMs: 2200,
  // Prepend a lead-in so the first word is never clipped.
  preSpeechPadMs: 320,
  // Ignore blips shorter than this (a cough, a click, a single "mm").
  minSpeechMs: 320,
  // Detection thresholds. Slightly conservative-positive to resist background false
  // triggers, but not so high that soft/quiet speech is missed.
  positiveSpeechThreshold: 0.55,
  negativeSpeechThreshold: 0.4,
} as const;

/**
 * getUserMedia audio constraints for hands-free. Browser-native echo cancellation
 * (drops Marcus's own voice coming back through the speaker), noise suppression
 * (background hum / TV), and auto gain. Explicitly enabled — previously implicit.
 */
export const HANDS_FREE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

/** Self-hosted VAD model + worklet + onnxruntime wasm (copied into /public/vad). */
export const VAD_ASSET_BASE = '/vad/';

/**
 * True when mic input must be IGNORED: Marcus is mid-turn (processing/speaking), so
 * the open mic must not capture his voice, or the user paused (held) the mic.
 */
export function shouldIgnoreInput(state: VoiceState, held: boolean): boolean {
  return held || state === 'processing' || state === 'speaking';
}

/**
 * After Marcus's audio fully ends, wait this long before reopening the mic for the
 * next turn. The HTMLAudioElement 'ended' event already guarantees his audio is done;
 * this short buffer keeps any residual room echo/tail off the VAD's first frame
 * (belt-and-suspenders with the always-on echoCancellation). ~400ms is below
 * perceptible lag but clears the handoff.
 */
export const REARM_COOLDOWN_MS = 400;

/**
 * Whether the mic should auto-reopen for the next turn after Marcus finishes. Pure so
 * the loop condition is unit-tested: reopen only in hands-free, only while the session
 * is still live (room mounted), and never while the user has muted.
 */
export function shouldRearm(opts: { handsFree: boolean; sessionEnded: boolean; muted: boolean }): boolean {
  return opts.handsFree && !opts.sessionEnded && !opts.muted;
}

/**
 * Encode 16 kHz mono Float32 PCM (as delivered by the VAD's onSpeechEnd) into a
 * 16-bit PCM WAV buffer, so the existing /api/conversation (Whisper) accepts it
 * unchanged — the server detects `wav` from the mime type. Server stays byte-identical.
 */
export function floatToWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = sr * blockAlign
  view.setUint16(32, 2, true); // block align = channels * bytesPerSample
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
