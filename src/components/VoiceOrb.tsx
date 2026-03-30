'use client';

import { useState, useRef, useCallback } from 'react';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

interface VoiceOrbProps {
  onStateChange: (state: VoiceState) => void;
  onTranscript: (userText: string, marcusText: string) => void;
  userId: string;
  conversationId: string | null;
  onConversationId: (id: string) => void;
  state: VoiceState;
}

export default function VoiceOrb({
  onStateChange,
  onTranscript,
  userId,
  conversationId,
  onConversationId,
  state,
}: VoiceOrbProps) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      onStateChange('listening');
    } catch (err) { console.error('Mic access error:', err); }
  }, [onStateChange]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      onStateChange('processing');
    }
  }, [isRecording, onStateChange]);

  const sendAudio = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('userId', userId);
      if (conversationId) formData.append('conversationId', conversationId);
      const res = await fetch('/api/conversation', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const convId = res.headers.get('X-Conversation-Id');
      if (convId && !conversationId) onConversationId(convId);
      const userText = decodeURIComponent(res.headers.get('X-User-Text') || '');
      const marcusText = decodeURIComponent(res.headers.get('X-Marcus-Text') || '');
      onTranscript(userText, marcusText);
      const audioBuffer = await res.arrayBuffer();
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      onStateChange('speaking');
      audio.onended = () => { onStateChange('idle'); URL.revokeObjectURL(url); };
      await audio.play();
    } catch (err) { console.error('Send audio error:', err); onStateChange('idle'); }
  };

  const handleClick = () => { isRecording ? stopRecording() : startRecording(); };

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
        className={cn(
          'relative w-20 h-20 rounded-full flex items-center justify-center',
          'transition-all duration-500 focus:outline-none cursor-pointer',
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

