'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square } from 'lucide-react';
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

  const orbClass = state === 'listening' ? 'orb-listening'
    : state === 'speaking' ? 'orb-speaking'
    : state === 'processing' ? '' : 'orb-idle';

  return (
    <div className="relative flex items-center justify-center">
      {/* Ambient rings */}
      {state === 'listening' && (
        <>
          <div className="absolute w-32 h-32 rounded-full bg-red-500/8 pulse-ring" />
          <div className="absolute w-28 h-28 rounded-full bg-red-500/5 pulse-ring" style={{ animationDelay: '0.6s' }} />
        </>
      )}
      {state === 'speaking' && (
        <>
          <div className="absolute w-32 h-32 rounded-full bg-[#a3785e]/8 pulse-ring" style={{ animationDuration: '3s' }} />
          <div className="absolute w-28 h-28 rounded-full bg-[#a3785e]/5 pulse-ring" style={{ animationDuration: '3s', animationDelay: '0.8s' }} />
        </>
      )}
      {state === 'processing' && (
        <div className="absolute w-24 h-24 rounded-full border-2 border-transparent border-t-[#a3785e]/40 animate-spin" />
      )}

      {/* Main orb */}
      <button
        onClick={handleClick}
        disabled={disabled || state === 'processing' || state === 'speaking'}
        className={cn(
          'relative w-20 h-20 rounded-full flex items-center justify-center',
          'transition-all duration-500 focus:outline-none',
          (disabled || state === 'processing' || state === 'speaking') ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
          orbClass
        )}
        style={{
          background: isRecording
            ? 'radial-gradient(circle at 35% 35%, rgba(220,38,38,0.15), rgba(220,38,38,0.05))'
            : state === 'speaking'
              ? 'radial-gradient(circle at 35% 35%, rgba(163,120,94,0.15), rgba(163,120,94,0.05))'
              : 'radial-gradient(circle at 35% 35%, rgba(163,120,94,0.08), rgba(163,120,94,0.02))',
          border: isRecording
            ? '1px solid rgba(220,38,38,0.25)'
            : '1px solid rgba(163,120,94,0.2)',
        }}
      >
        {isRecording ? (
          <Square className="w-5 h-5 text-red-500 fill-red-500/80" />
        ) : (
          <Mic className={cn(
            'w-6 h-6 transition-colors',
            state === 'speaking' ? 'text-[#a3785e]' : 'text-[#a3785e]/70'
          )} />
        )}
      </button>
    </div>
  );
}

