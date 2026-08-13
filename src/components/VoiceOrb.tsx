'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { MicVAD } from '@ricky0123/vad-web';
import { VAD_TUNING, HANDS_FREE_AUDIO_CONSTRAINTS, VAD_ASSET_BASE, floatToWav } from '@/lib/voice/handsFree';

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

  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { onConversationIdRef.current = onConversationId; }, [onConversationId]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

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
      audio.onended = () => { onStateChangeRef.current('idle'); URL.revokeObjectURL(url); };
      audio.play().catch((e) => { console.warn('Audio play error:', e); onStateChangeRef.current('idle'); URL.revokeObjectURL(url); });
    } catch (err) {
      // Timeout (abort) or non-OK response: surface a real message, not a silent idle.
      console.error('Send audio error:', err);
      onErrorRef.current?.("That one took too long — try saying a bit less and I'll keep up.");
      onStateChangeRef.current('idle');
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
    (async () => {
      try {
        // Browser-only; dynamic import avoids SSR execution of the wasm/worklet loader.
        const { MicVAD } = await import('@ricky0123/vad-web');
        const vad = await MicVAD.new({
          model: VAD_TUNING.model,
          baseAssetPath: VAD_ASSET_BASE,
          onnxWASMBasePath: VAD_ASSET_BASE,
          positiveSpeechThreshold: VAD_TUNING.positiveSpeechThreshold,
          negativeSpeechThreshold: VAD_TUNING.negativeSpeechThreshold,
          redemptionMs: VAD_TUNING.redemptionMs,
          preSpeechPadMs: VAD_TUNING.preSpeechPadMs,
          minSpeechMs: VAD_TUNING.minSpeechMs,
          // Inject our echo-cancel / noise-suppress constraints via the stream hook.
          getStream: () => navigator.mediaDevices.getUserMedia({ audio: HANDS_FREE_AUDIO_CONSTRAINTS }),
          onSpeechStart: () => { if (!busyRef.current) onStateChangeRef.current('listening'); },
          onVADMisfire: () => { if (!busyRef.current) onStateChangeRef.current('idle'); },
          onSpeechEnd: (audio: Float32Array) => {
            // Never send audio captured while Marcus is mid-turn (his own voice).
            if (busyRef.current) return;
            const blob = new Blob([floatToWav(audio, 16000)], { type: 'audio/wav' });
            onStateChangeRef.current('processing');
            void sendAudio(blob, 'speech.wav');
          },
        });
        if (cancelled) { void vad.destroy(); return; }
        vadRef.current = vad;
        if (!busyRef.current) await vad.start();
      } catch (err) {
        console.error('VAD init failed:', err);
        onErrorRef.current?.('hands-free could not start — switch to tap-to-talk below.');
      }
    })();
    return () => { cancelled = true; const v = vadRef.current; vadRef.current = null; void v?.destroy(); };
  }, [handsFree, sendAudio]);

  // Pause the open mic while Marcus is processing/speaking so it never captures his
  // response; resume listening when he's done. (Guarantees no self-capture on top of
  // browser echoCancellation.)
  useEffect(() => {
    busyRef.current = state === 'processing' || state === 'speaking';
    const vad = vadRef.current;
    if (!vad || !handsFree) return;
    if (busyRef.current) void vad.pause();
    else void vad.start().catch(() => {});
  }, [state, handsFree]);

  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);
  useEffect(() => { stopRecordingRef.current = stopRecording; }, [stopRecording]);

  const handleClick = () => {
    // Hands-free is automatic — nothing to press. (Fallback tap lives in classic mode.)
    if (handsFree) return;
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
