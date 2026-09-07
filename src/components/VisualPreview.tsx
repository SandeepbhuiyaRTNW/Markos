"use client";

import { useState } from 'react';
import { MessageSquare, Loader2, Shield, X } from 'lucide-react';
import Orb3D from './Orb3D';
import ShaderBackground, { emotionToRegister } from './ShaderBackground';
import AppHeader from './AppHeader';

/** Development-only visual preview. Real room markup; sample data; no microphone or API calls. */
export default function VisualPreview({ emotion = 'calm', state = 'speaking' }: { emotion?: string; state?: 'idle' | 'listening' | 'processing' | 'speaking' }) {
  const register = emotionToRegister(emotion) ?? 0.3;
  const [showTranscript, setShowTranscript] = useState(false);
  const [handsFree, setHandsFree] = useState(true);
  const [muted, setMuted] = useState(false);
  const voiceError = null;
  const openingLoading = false, endingSession = false;
  const conversationId = 'visual-preview';
  const openingMessage = 'What’s on your mind?';
  const transcripts = [{ user: 'I keep carrying work home with me.', marcus: 'You don’t have to carry it all at once.' }];
  const handleGoToAnalytics = () => window.location.assign('/');
  const handleEndSession = handleGoToAnalytics;
    return (
      <div className="voice-room h-screen w-screen flex flex-col relative overflow-hidden" style={{ background: '#faf9f6' }}>
        {/* Ambient Paper Shaders backdrop — driven by conversation state + a slow
            emotional register. Presentation only; sits behind all content (z-0). */}
        <ShaderBackground state={state} register={register} />
        <AppHeader mode="focused" onHome={handleGoToAnalytics} onClose={handleGoToAnalytics} />

        {/* Session row — prototype's single flex:1 align-items:center row; content centered */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-6 sm:px-10 lg:px-16 py-9 min-h-0" style={{ borderBottom: '2px solid #14100e' }}>
          <div className="flex items-center gap-8 sm:gap-11 w-full" style={{ maxWidth: 860 }}>
            <div className="relative flex-none flex items-center justify-center">
              <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
                <Orb3D size={244} activity={state} register={register} getLevel={() => 0.3 + Math.sin(performance.now() / 450) * 0.22} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <span
                className="block"
                style={{ fontSize: 9, letterSpacing: '.26em', textTransform: 'uppercase',
                  color: (state === 'listening' || state === 'processing') ? '#6b6259' : '#713b12' }}
              >
                {(state === 'listening' || state === 'processing') ? 'You' : 'Marcus'}
              </span>
              {state === 'listening' ? (
                <>
                  <p className="font-serif" style={{ margin: '14px 0 0', fontSize: 22, lineHeight: 1.5, color: '#3d352e' }}>
                    I&rsquo;m listening.
                  </p>
                  <div className="flex items-end gap-1" style={{ height: 22, marginTop: 22 }}>
                    {[0, 0.1, 0.22, 0.34, 0.46, 0.58, 0.7].map((d, i) => (
                      <span key={i} style={{ width: 3, background: i < 5 ? '#b0611f' : '#c9b9a2', animation: 'level 1s ease-in-out infinite', animationDelay: `${d}s` }} />
                    ))}
                  </div>
                </>
              ) : state === 'processing' ? (
                <p className="font-serif" style={{ margin: '22px 0 0', fontSize: 19, fontStyle: 'italic', color: '#6b6259' }}>
                  Reflecting&hellip;
                </p>
              ) : state === 'speaking' && transcripts.length > 0 ? (
                <>
                  <p className="font-serif" style={{ margin: '14px 0 0', fontSize: 26, lineHeight: 1.45, color: '#14100e', textWrap: 'pretty' }}>
                    {transcripts[transcripts.length - 1].marcus}
                  </p>
                  <p style={{ margin: '18px 0 0', fontSize: 12.5, lineHeight: 1.6, color: '#6b6259' }}>
                    Start speaking any time &mdash; he will stop.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-serif" style={{ margin: '14px 0 0', fontSize: 24, lineHeight: 1.5, color: '#14100e' }}>
                    {openingLoading ? 'One moment…' : 'The mic is open.'}
                  </p>
                  <p style={{ margin: '18px 0 0', fontSize: 12.5, lineHeight: 1.6, color: '#6b6259' }}>
                    Speak whenever you are ready &mdash; no button to hold.
                  </p>
                </>
              )}
              {voiceError && (
                <p style={{ margin: '14px 0 0', fontSize: 12, color: '#713b12', maxWidth: 420 }}>{voiceError}</p>
              )}
            </div>
          </div>
        </div>

        {/* Footer — status (left) + End Session (right), aligned to the same centered column */}
        <div className="relative z-10 flex-none px-6 sm:px-10 lg:px-16" style={{ height: 66 }}>
          <div className="mx-auto w-full h-full flex items-center justify-between" style={{ maxWidth: 860 }}>
            <div className="flex items-center gap-3">
              <span style={{ width: 7, height: 7,
                background: state === 'processing' ? '#c9b9a2' : '#b0611f',
                animation: state === 'processing' ? 'none' : `dot-pulse ${state === 'listening' ? '1.4s' : state === 'speaking' ? '2.6s' : '3s'} ease-in-out infinite` }} />
              <span style={{ fontSize: 10, letterSpacing: '.26em', textTransform: 'uppercase', color: '#5c534b' }}>
                {state === 'listening' ? 'Listening · pause when you pause'
                  : state === 'processing' ? 'Reflecting · he will not cut you off'
                  : state === 'speaking' ? 'Speaking'
                  : 'Mic open'}
              </span>
              {/* Input mode: hands-free (VAD) ↔ tap-to-talk fallback */}
              <button
                onClick={() => setHandsFree((v) => !v)}
                className="ml-1 text-[10px] font-medium uppercase tracking-[.14em] transition-opacity hover:underline underline-offset-4"
                style={{ color: handsFree ? '#713b12' : '#6b6259' }}
                title={handsFree ? 'Switch to tap-to-talk' : 'Switch to hands-free'}
              >
                · {handsFree ? 'hands-free' : 'tap to talk'}
              </button>
              {/* Manual mute — pause the mic mid-session without ending it */}
              {handsFree && (
                <button
                  onClick={() => setMuted((v) => !v)}
                  className="ml-1 text-[10px] font-medium uppercase tracking-[.14em] transition-opacity hover:underline underline-offset-4"
                  style={{ color: muted ? '#713b12' : '#6b6259' }}
                  title={muted ? 'Unmute the mic' : 'Mute the mic'}
                  aria-pressed={muted}
                >
                  · {muted ? 'muted' : 'mute'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              {/* Transcript toggle — opens/closes the running-session side panel */}
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="flex items-center gap-2 h-[38px] px-3 text-[10.5px] font-medium uppercase tracking-[.14em] transition-colors"
                style={{ color: showTranscript ? '#713b12' : '#5c534b' }}
                aria-pressed={showTranscript}
              >
                <MessageSquare className="w-3.5 h-3.5" /> Transcript
              </button>
              {(transcripts.length > 0 || openingMessage) && conversationId && (
                <button
                  onClick={handleEndSession}
                  disabled={endingSession}
                  className="flex items-center gap-2 h-[38px] px-4 text-[10.5px] font-semibold uppercase tracking-[.14em] text-[#14100e] border-2 border-[#14100e] hover:bg-[#14100e] hover:text-[#faf9f6] transition-colors disabled:cursor-not-allowed"
                >
                  {endingSession ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /> Ending…</>) : (<><Shield className="w-3.5 h-3.5" /> End Session</>)}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Transcript side panel — slides in from the right, OVERLAYS (orb stays centered). */}
        {/* Styling per Prototype 2B §4.7: 360px, 2px ink left rule, header + who-labelled turns. */}
        <div
          className="absolute top-0 right-0 h-full flex flex-col z-30 transition-transform duration-300 ease-in-out"
          style={{
            width: 360, maxWidth: '85vw', background: '#faf9f6', borderLeft: '2px solid #14100e',
            transform: showTranscript ? 'translateX(0)' : 'translateX(100%)',
            boxShadow: showTranscript ? '-24px 0 48px -24px rgba(20,16,14,.35)' : 'none',
          }}
          aria-hidden={!showTranscript}
        >
          <div className="flex-none flex items-center justify-between" style={{ padding: '18px 24px', borderBottom: '1px solid #e4dfd7' }}>
            <span style={{ fontSize: 9, letterSpacing: '.24em', textTransform: 'uppercase', color: '#6b6259' }}>Transcript</span>
            <button
              onClick={() => setShowTranscript(false)}
              className="flex items-center justify-center hover:bg-[#f2efe8] transition-colors"
              style={{ width: 26, height: 26, border: '1px solid #ded8cf' }}
              aria-label="Close transcript"
            >
              <X className="w-3.5 h-3.5" style={{ color: '#6b6259' }} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto" style={{ padding: '20px 24px' }}>
            {(!openingMessage && transcripts.length === 0) ? (
              <p style={{ fontSize: 12, color: '#6b6259' }}>Nothing said yet.</p>
            ) : (
              <div className="flex flex-col" style={{ gap: 20 }}>
                {openingMessage && (
                  <div className="flex flex-col" style={{ gap: 7 }}>
                    <span style={{ fontSize: 9, letterSpacing: '.24em', textTransform: 'uppercase', color: '#713b12' }}>Marcus</span>
                    <p className="font-serif" style={{ margin: 0, fontSize: 19, lineHeight: 1.62, color: '#3d352e' }}>{openingMessage}</p>
                  </div>
                )}
                {transcripts.map((t, i) => (
                  <div key={i} className="flex flex-col" style={{ gap: 20 }}>
                    <div className="flex flex-col" style={{ gap: 7 }}>
                      <span style={{ fontSize: 9, letterSpacing: '.24em', textTransform: 'uppercase', color: '#6b6259' }}>You</span>
                      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.62, color: '#3d352e' }}>{t.user}</p>
                    </div>
                    <div className="flex flex-col" style={{ gap: 7 }}>
                      <span style={{ fontSize: 9, letterSpacing: '.24em', textTransform: 'uppercase', color: '#713b12' }}>Marcus</span>
                      <p className="font-serif" style={{ margin: 0, fontSize: 19, lineHeight: 1.62, color: '#3d352e' }}>{t.marcus}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
}
