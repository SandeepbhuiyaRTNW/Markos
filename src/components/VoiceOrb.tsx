'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { MicVAD } from '@ricky0123/vad-web';
import { VAD_TUNING, HANDS_FREE_AUDIO_CONSTRAINTS, VAD_ASSET_BASE, floatToWav, REARM_COOLDOWN_MS, HandsFreeLoop } from '@/lib/voice/handsFree';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

// Client abort must sit ABOVE the route's `maxDuration = 60` (and the AWS SSR /
// CloudFront origin-response timeouts it is capped by) plus a few seconds of
// network/transfer, so the CLIENT is the outer boundary. Keep in sync with
// maxDuration = 60 in the conversation route(s).
const CLIENT_TIMEOUT_MS = 65000;

interface VoiceOrbProps {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (userText: string, marcusText: string) => void;
  userId: string;
  conversationId: string | null;
  onConversationId: (id: string) => void;
  onError?: (message: string) => void;
  state: VoiceState;
  disabled?: boolean;
  /** Hands-free (VAD, mic open, auto start/stop) vs classic tap-to-talk fallback. */
  handsFree?: boolean;
  /** User-muted: pause the open mic without ending the session. */
  muted?: boolean;
}

export default function VoiceOrb({
  onStateChange,
  onTranscript,
  userId,
  conversationId,
  onConversationId,
  onError,
  state,
  disabled = false,
  handsFree = true,
  muted = false,
}: VoiceOrbProps) {
  const [isRecording, setIsRecording] = useState(false); // classic tap-to-talk only
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vadRef = useRef<MicVAD | null>(null);

  // ─── REFS to avoid stale closures in MediaRecorder / VAD callbacks ───
  const conversationIdRef = useRef(conversationId);
  const userIdRef = useRef(userId);
  const onConversationIdRef = useRef(onConversationId);
  const onTranscriptRef = useRef(onTranscript);
  const onStateChangeRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);
  // True while Marcus is processing/speaking — the open mic must ignore its own
  // playback so it never captures his voice (belt-and-suspenders with echoCancellation).
  const busyRef = useRef(false);

  // ─── Hands-free continuous loop state ───
  const handsFreeRef = useRef(handsFree);
  const mutedRef = useRef(muted);
  const sessionEndedRef = useRef(false); // true once the room unmounts / VAD destroyed
  const loopRef = useRef<HandsFreeLoop | null>(null);

  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { onConversationIdRef.current = onConversationId; }, [onConversationId]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);

  // Create the loop controller once. It owns the serialized start/pause queue + the
  // cooldown reopen; the VAD + <audio> below are wired into it. The logger is TEMP
  // tracing so the full loop is observable at runtime in the browser console.
  if (loopRef.current === null) {
    loopRef.current = new HandsFreeLoop({
      getVad: () => vadRef.current,
      isBusy: () => busyRef.current,
      isMuted: () => mutedRef.current,
      isEnded: () => sessionEndedRef.current,
      log: (m) => console.log('[hands-free]', m), // TEMP: remove after live verification
      scheduleAfterCooldown: (cb) => {
        const t = setTimeout(cb, REARM_COOLDOWN_MS);
        return () => clearTimeout(t);
      },
      onReopenFailed: () => onErrorRef.current?.('The mic didn’t reopen — tap the orb to keep going.'),
    });
  }

  // ─── Cloud call + client-side handling (UNCHANGED contract: POST /api/conversation) ───
  const sendAudio = useCallback(async (blob: Blob, filename: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const formData = new FormData();
      formData.append('audio', blob, filename);
      formData.append('userId', userIdRef.current);
      if (conversationIdRef.current) formData.append('conversationId', conversationIdRef.current);
      const res = await fetch('/api/conversation', { method: 'POST', body: formData, signal: controller.signal });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      loopRef.current?.sent();
      const convId = res.headers.get('X-Conversation-Id');
      if (convId && !conversationIdRef.current) {
        conversationIdRef.current = convId;
        onConversationIdRef.current(convId);
      }
      const userText = decodeURIComponent(res.headers.get('X-User-Text') || '');
      const marcusText = decodeURIComponent(res.headers.get('X-Marcus-Text') || '');
      onTranscriptRef.current(userText, marcusText);
      const audioBuffer = await res.arrayBuffer();
      const url = URL.createObjectURL(new Blob([audioBuffer], { type: 'audio/mpeg' }));
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      onStateChangeRef.current('speaking');
      loopRef.current?.marcusPlaying();
      audio.onended = () => {
        onStateChangeRef.current('idle');
        URL.revokeObjectURL(url);
        // Close the loop: Marcus's audio has fully finished ('ended'), so reopen the
        // mic for the next turn after the clean-handoff cooldown.
        loopRef.current?.marcusEnded();
      };
      audio.play().catch((e) => {
        console.warn('Audio play error:', e);
        onStateChangeRef.current('idle');
        URL.revokeObjectURL(url);
        loopRef.current?.marcusEnded();
      });
    } catch (err) {
      // Timeout (abort) or non-OK response: surface a real message, not a silent idle.
      console.error('Send audio error:', err);
      onErrorRef.current?.("That one took too long — try saying a bit less and I'll keep up.");
      onStateChangeRef.current('idle');
      loopRef.current?.turnFailed(); // a failed turn must not dead-end the hands-free loop
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  // ─── Classic tap-to-talk (fallback; used when handsFree === false) ───
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: HANDS_FREE_AUDIO_CONSTRAINTS });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await sendAudio(new Blob(chunksRef.current, { type: 'audio/webm' }), 'recording.webm');
      };
      mediaRecorder.start();
      setIsRecording(true);
      onStateChangeRef.current('listening');
    } catch (err) {
      console.error('Mic access error:', err);
      onErrorRef.current?.('I could not reach your microphone.');
    }
  }, [sendAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      onStateChangeRef.current('processing');
    }
  }, [isRecording]);

  // ─── Hands-free VAD (default): mic stays open, auto start/stop on speech ───
  useEffect(() => {
    if (!handsFree) return;
    let cancelled = false;
    sessionEndedRef.current = false;
    console.log('[hands-free] VAD init: starting'); // TEMP: pinpoint where init stalls
    (async () => {
      try {
        // Browser-only; dynamic import avoids SSR execution of the wasm/worklet loader.
        const { MicVAD } = await import('@ricky0123/vad-web');
        console.log('[hands-free] VAD init: loading model + worklet + wasm');
        const vad = await MicVAD.new({
          model: VAD_TUNING.model,
          baseAssetPath: VAD_ASSET_BASE,
          onnxWASMBasePath: VAD_ASSET_BASE,
          // Run the ONNX runtime SINGLE-THREADED so it loads on a normal page WITHOUT
          // cross-origin isolation (no COOP/COEP / SharedArrayBuffer). Multi-threaded
          // wasm silently fails to init on a non-isolated page.
          ortConfig: (ort) => { ort.env.wasm.numThreads = 1; },
          positiveSpeechThreshold: VAD_TUNING.positiveSpeechThreshold,
          negativeSpeechThreshold: VAD_TUNING.negativeSpeechThreshold,
          redemptionMs: VAD_TUNING.redemptionMs,
          preSpeechPadMs: VAD_TUNING.preSpeechPadMs,
          minSpeechMs: VAD_TUNING.minSpeechMs,
          // Inject our echo-cancel / noise-suppress constraints via the stream hook.
          getStream: () => navigator.mediaDevices.getUserMedia({ audio: HANDS_FREE_AUDIO_CONSTRAINTS }),
          onSpeechStart: () => {
            if (busyRef.current) return;
            onStateChangeRef.current('listening');
            loopRef.current?.speechDetected();
          },
          onVADMisfire: () => { if (!busyRef.current) onStateChangeRef.current('idle'); },
          onSpeechEnd: (audio: Float32Array) => {
            // Never send audio captured while Marcus is mid-turn (his own voice).
            if (busyRef.current) return;
            loopRef.current?.speechEnded();
            const blob = new Blob([floatToWav(audio, 16000)], { type: 'audio/wav' });
            onStateChangeRef.current('processing');
            void sendAudio(blob, 'speech.wav');
          },
        });
        if (cancelled) { void vad.destroy(); return; }
        vadRef.current = vad;
        console.log('[hands-free] VAD init: model ready — starting mic');
        if (!busyRef.current && !mutedRef.current) {
          await vad.start();
          loopRef.current?.listeningStarted();
        }
      } catch (err) {
        console.error('[hands-free] VAD init FAILED — hands-free will not start:', err);
        onErrorRef.current?.('hands-free could not start — switch to tap-to-talk below.');
      }
    })();
    return () => {
      cancelled = true;
      sessionEndedRef.current = true; // stop any pending reopen from firing after unmount
      loopRef.current?.cancelReopen();
      const v = vadRef.current; vadRef.current = null; void v?.destroy();
    };
  }, [handsFree, sendAudio]);

  // Pause the open mic the moment Marcus starts (processing/speaking) so it never
  // captures his voice. RESUME is explicit — the loop's marcusEnded() fires after his
  // audio 'ended' event, not here — so the reopen is echo-guarded and observable.
  useEffect(() => {
    busyRef.current = state === 'processing' || state === 'speaking';
    if (!handsFree) return;
    if (busyRef.current) loopRef.current?.pauseForMarcus();
  }, [state, handsFree]);

  // Manual mute (footer): pause immediately; on unmute, reopen if Marcus isn't talking.
  useEffect(() => {
    mutedRef.current = muted;
    if (!handsFree) return;
    if (muted) loopRef.current?.muteMic();
    else if (!busyRef.current) loopRef.current?.reopenNow();
  }, [muted, handsFree]);

  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);
  useEffect(() => { stopRecordingRef.current = stopRecording; }, [stopRecording]);

  const handleClick = () => {
    if (handsFree) {
      // Hands-free reopens on its own after every turn. A tap is a manual "reopen now"
      // recovery for the rare case the auto re-arm failed; harmless while already
      // listening (start() no-ops) and ignored while Marcus is mid-turn.
      if (!busyRef.current) loopRef.current?.reopenNow();
      return;
    }
    if (disabled || state === 'processing' || state === 'speaking') return;
    if (isRecording) stopRecordingRef.current(); else startRecordingRef.current();
  };

  // ─── Render: pure-CSS stone orb, state-driven rings/rim (unchanged visuals) ───
  const rimAlpha = state === 'speaking' ? 0.8 : state === 'listening' ? 0.62 : 0.5;
  const rimAnim = state === 'speaking' ? 'rim-pulse 2.6s ease-in-out infinite' : 'none';
  const orbSat = disabled ? 0.35 : 1;
  const interactive = !handsFree && !(disabled || state === 'processing' || state === 'speaking');

  return (
    <div
      onClick={handleClick}
      role={handsFree ? undefined : 'button'}
      tabIndex={handsFree ? -1 : 0}
      aria-label={handsFree ? 'Hands-free listening' : isRecording ? 'Stop speaking' : 'Start speaking'}
      className={cn('relative flex items-center justify-center select-none', interactive ? 'cursor-pointer' : 'cursor-default')}
      style={{ width: 220, height: 220 }}
    >
      {/* listening — two terracotta ripple rings */}
      {state === 'listening' && (
        <>
          <div className="absolute rounded-full" style={{ width: 204, height: 204, border: '1px solid rgba(176,97,31,.4)', animation: 'ring-out 3.4s ease-out infinite' }} />
          <div className="absolute rounded-full" style={{ width: 204, height: 204, border: '1px solid rgba(176,97,31,.28)', animation: 'ring-out 3.4s ease-out infinite', animationDelay: '1.2s' }} />
        </>
      )}
      {/* processing — single spinning terracotta-topped arc */}
      {state === 'processing' && (
        <div className="absolute rounded-full" style={{ width: 232, height: 232, border: '1px solid #e4dfd7', borderTopColor: '#b0611f', animation: 'arc-turn 5.5s linear infinite' }} />
      )}

      {/* orb body — pearlescent stone sphere */}
      <div
        className="relative rounded-full"
        style={{
          width: 204, height: 204,
          background: 'radial-gradient(circle at 34% 30%,#ffffff 0%,#f2eee6 22%,#ded7cb 52%,#b8ada0 82%,#8e8377 100%)',
          boxShadow: '0 26px 50px -20px rgba(60,52,44,.5), inset 0 -22px 44px rgba(90,80,68,.28), inset 0 12px 22px rgba(255,255,255,.7), 0 0 0 1px rgba(20,16,14,.08)',
          animation: 'orb-still 8s ease-in-out infinite',
          filter: `saturate(${orbSat})`,
        }}
      />
      {/* rim glow */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 204, height: 204,
          background: `radial-gradient(circle at 74% 76%,rgba(176,97,31,${disabled ? 0.12 : rimAlpha}),transparent 44%)`,
          mixBlendMode: 'multiply',
          animation: rimAnim,
        }}
      />
    </div>
  );
}