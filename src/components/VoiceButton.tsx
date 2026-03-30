'use client';

import { useState, useRef, useCallback } from 'react';

interface VoiceButtonProps {
  onStateChange: (state: 'idle' | 'listening' | 'processing' | 'speaking') => void;
  onTranscript: (userText: string, marcusText: string) => void;
  userId: string;
  conversationId: string | null;
  onConversationId: (id: string) => void;
}

export default function VoiceButton({
  onStateChange,
  onTranscript,
  userId,
  conversationId,
  onConversationId,
}: VoiceButtonProps) {
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

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await sendAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      onStateChange('listening');
    } catch (err) {
      console.error('Mic access error:', err);
    }
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

      // Play audio response
      const audioBuffer = await res.arrayBuffer();
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;

      onStateChange('speaking');
      audio.onended = () => {
        onStateChange('idle');
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (err) {
      console.error('Send audio error:', err);
      onStateChange('idle');
    }
  };

  const handleClick = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <button
      onClick={handleClick}
      className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 focus:outline-none"
      style={{
        background: isRecording
          ? 'radial-gradient(circle, #ef4444 0%, #991b1b 100%)'
          : 'radial-gradient(circle, #ffffff 0%, #a3a3a3 100%)',
      }}
    >
      {isRecording && (
        <div className="absolute inset-0 rounded-full bg-red-500/30 pulse-ring" />
      )}
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke={isRecording ? '#ffffff' : '#000000'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  );
}

