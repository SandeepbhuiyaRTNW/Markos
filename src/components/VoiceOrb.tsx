'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { MicVAD } from '@ricky0123/vad-web';
import { VAD_TUNING, HANDS_FREE_AUDIO_CONSTRAINTS, VAD_ASSET_BASE, floatToWav, REARM_COOLDOWN_MS, HandsFreeLoop } from '@/lib/voice/handsFree';
import { ORB } from '@/components/OrbShader';
import Orb3D from '@/components/Orb3D';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

// Client abort must sit ABOVE the route's `maxDuration = 60` (and the AWS SSR /
// CloudFront origin-response timeouts it is capped by) plus a few seconds of
// network/transfer, so the CLIENT is the outer boundary. Keep in sync with
// maxDuration = 60 in the conversation route(s).
const CLIENT_TIMEOUT_MS = 65000;

/** RMS amplitude of an audio frame (0..~1) — drives the orb's live surface. */
function rms(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return a.length ? Math.sqrt(s / a.length) : 0;
}

/**
 * Play the /api/conversation audio response.
 *
 * Where the browser supports MediaSource + mp3 (Chrome/Edge/Firefox, Safari 17.1+), we
 * play PROGRESSIVELY: audio starts as soon as ElevenLabs' first frames arrive, instead
 * of waiting for the whole clip. Elsewhere (older iOS Safari) we fall back to buffered
 * playback — the previous behavior, no regression, just no early start.
 *
 * The reply's text / voice / content is unchanged; only WHEN audio begins differs.
 *
 * onEnded fires when playback finishes OR the stream breaks (so the hands-free loop
 * always reopens the mic). onError surfaces a recoverable message on a mid-stream break
 * so a truncated reply is never silent.
 */
async function playResponseAudio(
  res: Response,
  hooks: {
    audioRef: { current: HTMLAudioElement | null };
    onSpeaking: () => void;
    onEnded: () => void;
    onError: (message: string) => void;
    /** Optional non-destructive tap for the orb's output level (see VoiceOrb). */
    attachMeter?: (audio: HTMLAudioElement) => void;
  },
): Promise<void> {
  const { audioRef, onSpeaking, onEnded, onError, attachMeter } = hooks;

  if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } }

  const canStream =
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function' &&
    MediaSource.isTypeSupported('audio/mpeg') &&
    !!res.body;

  // ── Fallback: buffered playback (previous behavior) ──
  if (!canStream) {
    const buf = await res.arrayBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
    const audio = new Audio(url);
    audioRef.current = audio;
    onSpeaking();
    attachMeter?.(audio);
    let done = false;
    const finish = () => { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch { /* ignore */ } onEnded(); };
    audio.onended = finish;
    audio.play().catch((e) => { console.warn('[tts] audio play error (buffered):', e); finish(); });
    return;
  }

  // ── Progressive playback via MediaSource ──
  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);
  const audio = new Audio();
  audio.src = url;
  audioRef.current = audio;
  onSpeaking();
  attachMeter?.(audio);

  let settled = false;
  const finish = (recover?: string) => {
    if (settled) return;
    settled = true;
    if (recover) onError(recover);
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    onEnded();
  };

  audio.onended = () => finish();
  audio.onerror = () => {
    console.error('[tts] <audio> element error during progressive playback');
    finish('Something cut the reply off — say that again and I’ll pick it back up.');
  };

  mediaSource.addEventListener('sourceopen', async () => {
    let sourceBuffer: SourceBuffer;
    try {
      sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
    } catch (e) {
      console.error('[tts] addSourceBuffer(audio/mpeg) failed:', e);
      finish('I couldn’t play that back — say that again and I’ll retry.');
      return;
    }

    const reader = res.body!.getReader();
    const queue: Uint8Array[] = [];
    let receiving = true;

    const pump = () => {
      if (sourceBuffer.updating) return;
      if (queue.length > 0) {
        // Cast: fetch chunks are always ArrayBuffer-backed at runtime; the strict lib
        // type widens to ArrayBufferLike, which appendBuffer's BufferSource rejects.
        try { sourceBuffer.appendBuffer(queue.shift()! as unknown as BufferSource); }
        catch (e) { console.error('[tts] appendBuffer failed:', e); }
        return;
      }
      if (!receiving && mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream(); } catch { /* already ended */ }
      }
    };
    sourceBuffer.addEventListener('updateend', pump);

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength) { queue.push(value); pump(); }
      }
      receiving = false;
      pump();
    } catch (err) {
      // Mid-stream break: log loudly, mark the media errored, and surface a recoverable
      // message. The hands-free loop still reopens the mic (via onEnded) so the user can
      // simply say it again — no silent half-played reply.
      receiving = false;
      console.error('[tts] ElevenLabs stream broke mid-play:', err);
      try { if (mediaSource.readyState === 'open') mediaSource.endOfStream('network'); } catch { /* ignore */ }
      finish('The reply cut out partway — say that again and I’ll finish it.');
    }
  });

  audio.play().catch((e) => {
    console.warn('[tts] audio play() rejected (progressive):', e);
    finish();
  });
}

interface VoiceOrbProps {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (userText: string, marcusText: string, emotion?: string) => void;
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

  // ─── Orb audio reactivity (VISUAL ONLY) — live levels the OrbShader reads ───
  // input  = mic RMS taken from the VAD's own frames (below), reusing its stream.
  // output = Marcus playback RMS from a NON-DESTRUCTIVE AnalyserNode (captureStream copies
  //          the element's audio without rerouting it). Neither touches mic/VAD/fetch/
  //          playback behavior; both fail safe to "no reactivity", never to broken audio.
  const audioLevelsRef = useRef({ input: 0, output: 0 });
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputMeterStopRef = useRef<(() => void) | null>(null);

  const attachOutputMeter = useCallback((audio: HTMLAudioElement) => {
    outputMeterStopRef.current?.();
    outputMeterStopRef.current = null;
    audioLevelsRef.current.output = 0;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const cap = audio as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
      const capture = cap.captureStream?.bind(audio) || cap.mozCaptureStream?.bind(audio);
      if (!AC || !capture) return; // e.g. Safari — skip; playback untouched, orb uses state baseline
      const stream = capture();
      if (!stream || stream.getAudioTracks().length === 0) return;
      const ctx = (outputAudioCtxRef.current ??= new AC());
      void ctx.resume?.();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = ORB.fftSize;
      const sink = ctx.createGain();
      sink.gain.value = 0; // keep the graph pulled but SILENT — the element already plays, no double audio
      src.connect(analyser); analyser.connect(sink); sink.connect(ctx.destination);
      const buf = new Float32Array(analyser.fftSize);
      let raf = requestAnimationFrame(function loop() {
        analyser.getFloatTimeDomainData(buf);
        audioLevelsRef.current.output = rms(buf);
        raf = requestAnimationFrame(loop);
      });
      const stop = () => {
        cancelAnimationFrame(raf);
        try { src.disconnect(); analyser.disconnect(); sink.disconnect(); } catch { /* ignore */ }
        audioLevelsRef.current.output = 0;
      };
      audio.addEventListener('ended', stop, { once: true });
      audio.addEventListener('pause', stop, { once: true });
      outputMeterStopRef.current = stop;
    } catch (e) {
      console.warn('[orb] output meter unavailable (playback unaffected):', e);
    }
  }, []);

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
      // X-Emotion = the pipeline's one-word primary_emotion (or 'neutral'). Surface it up so
      // page.tsx can drive the ambient background from it. This only READS a header already
      // on the response and passes it to the existing callback — mic / VAD / fetch / playback
      // are untouched.
      const emotion = res.headers.get('X-Emotion') || undefined;
      onTranscriptRef.current(userText, marcusText, emotion);
      // Play the reply. Progressive (streamed) where supported; buffered fallback
      // elsewhere. Same audio / voice / text — only WHEN it starts differs.
      await playResponseAudio(res, {
        audioRef,
        onSpeaking: () => { onStateChangeRef.current('speaking'); loopRef.current?.marcusPlaying(); },
        onEnded: () => {
          // Close the loop: playback finished (or the stream ended/broke), so reopen the
          // mic for the next turn after the clean-handoff cooldown.
          onStateChangeRef.current('idle');
          loopRef.current?.marcusEnded();
        },
        onError: (m) => onErrorRef.current?.(m),
        attachMeter: attachOutputMeter,
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
  }, [attachOutputMeter]);

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
          // Passive tap: the VAD already runs every mic frame through the model — compute
          // that frame's RMS to drive the orb while the user speaks. Reuses the VAD's own
          // stream + AudioContext (no second mic); does NOT affect speech detection.
          onFrameProcessed: (_probs, frame) => { audioLevelsRef.current.input = rms(frame); },
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

      {/* orb body — the Three.js orb, driven by the LIVE audio envelope (audioLevelsRef,
          already tapped below). Same component + shader as the landing page. Its own static
          gradient covers no-WebGL / reduced-motion, so it degrades cleanly. */}
      <Orb3D
        size={204}
        style={{ filter: `saturate(${orbSat})` }}
        getLevel={() => {
          const lv = audioLevelsRef.current;
          const raw = state === 'listening' ? lv.input * 6
            : state === 'speaking' ? lv.output * 3
            : state === 'processing' ? 0.5 : 0.22;
          return Math.min(1, raw);
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