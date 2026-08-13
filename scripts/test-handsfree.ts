// Pure-logic tests for the hands-free voice helpers (no mic, no DOM, no network).
// The VAD runtime behaviour (auto-detect, no-cutoff, ignore-Marcus, no false trigger)
// needs a real microphone — that's the live test. These lock the tunables + encoding.
// Run: npx tsx scripts/test-handsfree.ts
import { VAD_TUNING, HANDS_FREE_AUDIO_CONSTRAINTS, floatToWav, shouldIgnoreInput, shouldRearm, REARM_COOLDOWN_MS } from '../src/lib/voice/handsFree';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('\n── A. VAD tuning — errs toward WAITING (emotional pauses do not cut off) ──');
assert('redemptionMs is long (>= 2000ms) so a natural pause does not end the turn', VAD_TUNING.redemptionMs >= 2000, String(VAD_TUNING.redemptionMs));
assert('preSpeechPadMs prepends a lead-in (>= 200ms) so the first word is not clipped', VAD_TUNING.preSpeechPadMs >= 200);
assert('minSpeechMs filters blips (>= 250ms)', VAD_TUNING.minSpeechMs >= 250);
assert('negative threshold below positive (Silero convention)', VAD_TUNING.negativeSpeechThreshold < VAD_TUNING.positiveSpeechThreshold);
assert('thresholds within (0,1)', VAD_TUNING.positiveSpeechThreshold > 0 && VAD_TUNING.positiveSpeechThreshold < 1 && VAD_TUNING.negativeSpeechThreshold > 0);

console.log('\n── B. getUserMedia constraints — echo-cancel + noise-suppress explicitly ON ──');
assert('echoCancellation enabled (ignore Marcus’s own voice via the speaker)', HANDS_FREE_AUDIO_CONSTRAINTS.echoCancellation === true);
assert('noiseSuppression enabled (background hum / TV)', HANDS_FREE_AUDIO_CONSTRAINTS.noiseSuppression === true);
assert('autoGainControl enabled', HANDS_FREE_AUDIO_CONSTRAINTS.autoGainControl === true);

console.log('\n── C. Pause-during-Marcus gate — ignore the mic while he is mid-turn ──');
assert('ignore input while processing', shouldIgnoreInput('processing', false) === true);
assert('ignore input while speaking', shouldIgnoreInput('speaking', false) === true);
assert('ignore input while held', shouldIgnoreInput('idle', true) === true);
assert('accept input while idle & not held', shouldIgnoreInput('idle', false) === false);
assert('accept input while listening', shouldIgnoreInput('listening', false) === false);

console.log('\n── D. WAV encoder — Whisper-compatible 16-bit PCM WAV @16kHz ──');
const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
const buf = floatToWav(samples, 16000);
const view = new DataView(buf);
const str = (o: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(o + i)); return s; };
assert('total length = 44-byte header + 2 bytes/sample', buf.byteLength === 44 + samples.length * 2, String(buf.byteLength));
assert('RIFF magic', str(0, 4) === 'RIFF');
assert('WAVE magic', str(8, 4) === 'WAVE');
assert('fmt chunk', str(12, 4) === 'fmt ');
assert('data chunk', str(36, 4) === 'data');
assert('PCM format (1)', view.getUint16(20, true) === 1);
assert('mono (1 channel)', view.getUint16(22, true) === 1);
assert('sample rate 16000', view.getUint32(24, true) === 16000);
assert('16 bits per sample', view.getUint16(34, true) === 16);
assert('data size = samples * 2', view.getUint32(40, true) === samples.length * 2);
assert('full-scale +1 -> 32767', view.getInt16(44 + 3 * 2, true) === 0x7fff);
assert('full-scale -1 -> -32768', view.getInt16(44 + 4 * 2, true) === -0x8000);
assert('silence 0 -> 0', view.getInt16(44, true) === 0);

console.log('\n── E. Auto-reopen loop — mic re-arms after Marcus, cleanly, every turn ──');
assert('reopen cooldown exists and is a clean-handoff buffer (200–1000ms)', REARM_COOLDOWN_MS >= 200 && REARM_COOLDOWN_MS <= 1000, String(REARM_COOLDOWN_MS));
assert('reopens in hands-free, live session, not muted', shouldRearm({ handsFree: true, sessionEnded: false, muted: false }) === true);
assert('does NOT reopen once the session ended (room closed)', shouldRearm({ handsFree: true, sessionEnded: true, muted: false }) === false);
assert('does NOT reopen while muted', shouldRearm({ handsFree: true, sessionEnded: false, muted: true }) === false);
assert('does NOT auto-reopen in tap-to-talk mode', shouldRearm({ handsFree: false, sessionEnded: false, muted: false }) === false);

console.log('\n── SUMMARY ──');
console.log('  passed: ' + passed + '   failed: ' + failed);
if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); } else console.log('  ✅ SUITE PASSED');
