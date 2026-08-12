'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

// Client abort must sit ABOVE the route's `maxDuration = 60` (and the AWS SSR /
// CloudFront origin-response timeouts it is capped by) plus a few seconds of
// network/transfer, so the CLIENT is the outer boundary: it only aborts on a
// genuine hang or dead connection, never on a turn the server was about to
// finish. Keep in sync with maxDuration = 60 in the conversation route(s).
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
}: VoiceOrbProps) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ─── REFS to avoid stale closures in MediaRecorder callbacks ───
  // Without these, startRecording's useCallback captures stale values
  // and every voice message would create a new session (conversationId = null).
  const conversationIdRef = useRef(conversationId);
  const userIdRef = useRef(userId);
  const onConversationIdRef = useRef(onConversationId);
  const onTranscriptRef = useRef(onTranscript);
  const onStateChangeRef = useRef(onStateChange);
  const onErrorRef = useRef(onError);

  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { onConversationIdRef.current = onConversationId; }, [onConversationId]);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  const sendAudio = useCallback(async (audioBlob: Blob) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
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
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
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

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await sendAudio(new Blob(chunksRef.current, { type: 'audio/webm' }));
      };
      mediaRecorder.start();
      setIsRecording(true);
      onStateChangeRef.current('listening');
    } catch (err) { console.error('Mic access error:', err); }
  }, [sendAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      onStateChangeRef.current('processing');
    }
  }, [isRecording]);

  const handleClick = () => {
    // Don't allow interaction while Marcus is processing or speaking
    if (disabled || state === 'processing' || state === 'speaking') return;
    isRecording ? stopRecording() : startRecording();
  };

  // Prototype 2B orb — pure-CSS pearlescent stone sphere with state-driven rings
  // and terracotta rim. VoiceState -> orb state: idle=open, listening, processing=
  // reflecting (spinning arc), speaking (rim pulse), disabled=held (desaturated).
  const rimAlpha = state === 'speaking' ? 0.8 : state === 'listening' ? 0.62 : 0.5;
  const rimAnim = state === 'speaking' ? 'rim-pulse 2.6s ease-in-out infinite' : 'none';
  const orbSat = disabled ? 0.35 : 1;
  const interactive = !(disabled || state === 'processing' || state === 'speaking');

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={isRecording ? 'Stop speaking' : 'Start speaking'}
      className={cn('relative flex items-center justify-center select-none', interactive ? 'cursor-pointer' : 'cursor-not-allowed')}
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
      {/* held (disabled) — dashed grey static ring */}
      {disabled && (
        <div className="absolute rounded-full" style={{ width: 228, height: 228, border: '1px dashed #cdc6bc' }} />
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

