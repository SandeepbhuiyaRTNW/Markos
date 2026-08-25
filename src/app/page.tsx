'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Mic, History, Plus, Menu, X, Loader2, Send, ChevronRight, LogOut, Shield, BookOpen, Brain, ArrowRight, RotateCcw, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import VoiceOrb from '@/components/VoiceOrb';
import ShaderBackground, { deriveRegister, emotionToRegister } from '@/components/ShaderBackground';
import OnboardingFlow from '@/components/OnboardingFlow';
import ConversationView from '@/components/ConversationView';
import Sidebar from '@/components/Sidebar';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import SessionSummary from '@/components/SessionSummary';
import AppHeader from '@/components/AppHeader';
import SettingsScreen from '@/components/SettingsScreen';
import Orb3D from '@/components/Orb3D';
import IntroSequence from '@/components/IntroSequence';

// localStorage getters/setters throw "Access to storage is not allowed from this
// context" when the page runs in a storage-blocked / partitioned context (an embedded
// iframe, some privacy modes). Never let that crash a render or effect — degrade to a
// no-op / null so the app (and the voice loop it hosts) keeps running.
const safeLocal = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  remove: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';
type AppView = 'analytics' | 'voice' | 'session-detail' | 'session-notes' | 'settings';
type InputMode = 'session-type' | 'pick-session' | 'choice' | 'voice' | 'text' | 'listening';
type SessionType = 'continue' | 'fresh';

// Editorial helpers for the start screens (colours contrast-checked; see AnalyticsDashboard).
function relDayUpper(dateStr: string): string {
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return '';
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  const label = days <= 0 ? 'Today' : days === 1 ? 'Yesterday'
    : days < 7 ? dt.toLocaleDateString('en-US', { weekday: 'long' })
    : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return label.toUpperCase();
}
function clip(s: string, n: number): string { return s.length > n ? s.slice(0, n).trimEnd() + '…' : s; }

interface SessionNotesData {
  title?: string;
  summary?: string;
  takeaways?: string[];
  pondering_topics?: string[];
  pattern?: string;
  action_plan?: {
    actions?: string[];
    when_to_use?: string[];
    frequency?: string;
    fallback?: string;
    real_goal?: string;
  } | string[];  // backward compat with old format
  check_in?: string;
  mood?: string;
  stoic_principle?: string;
  topics?: string[];
}

interface Transcript {
  user: string;
  marcus: string;
  emotion?: string; // X-Emotion for this turn (one-word primary_emotion), when present
}

export default function Home() {
  const [state, setState] = useState<VoiceState>('idle');
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [authLoading, setAuthLoading] = useState(true); // Loading saved session
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);
  const [openingMessage, setOpeningMessage] = useState<string | null>(null);
  const [openingLoading, setOpeningLoading] = useState(false);
  const [view, setView] = useState<AppView>('analytics');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [refreshSidebar, setRefreshSidebar] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // UI-only: transcript side panel in the voice room. Default closed = immersive.
  const [showTranscript, setShowTranscript] = useState(false);
  // Hands-free voice (VAD, mic open, auto start/stop) vs classic tap-to-talk fallback.
  const [handsFree, setHandsFree] = useState(true);
  // Manual mute inside a hands-free session — pauses the mic without ending the session.
  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('session-type');
  const [startLoading, setStartLoading] = useState(false); // fetching prior sessions to decide the start fork
  const [introDone, setIntroDone] = useState(false);   // cinematic intro finished/skipped -> show landing
  const [pendingEntry, setPendingEntry] = useState(false); // just authed -> drop into the mic once ready
  const [sessionType, setSessionType] = useState<SessionType>('continue');
  const [continueFromId, setContinueFromId] = useState<string | null>(null);
  const [recentSessions, setRecentSessions] = useState<Array<{
    id: string; sessionNumber: number; title: string; summary: string | null;
    ponderingPreview: string | null; ponderingTopics: string[]; takeaways: string[];
    date: string; sessionType: string; lastUserMessage?: string | null;
  }>>([]);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [textSending, setTextSending] = useState(false);
  const [sessionNotes, setSessionNotes] = useState<SessionNotesData | null>(null);
  const [endingSession, setEndingSession] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [authStep, setAuthStep] = useState<'email' | 'otp' | 'password'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fetchingOpeningRef = useRef(false);
  const viewRef = useRef<AppView>(view);
  viewRef.current = view;

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedId = safeLocal.get('marcus_userId');
    const savedEmail = safeLocal.get('marcus_email');
    if (savedId && savedEmail) {
      setUserId(savedId);
      setUserEmail(savedEmail);
      setInitialized(true);
    }
    setAuthLoading(false);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts, openingMessage]);

  useEffect(() => {
    if (!userId) return;
    setCheckingOnboarding(true);
    fetch(`/api/onboarding?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        setOnboardingComplete(data.onboardingComplete || false);
        setCheckingOnboarding(false);
      })
      .catch(() => setCheckingOnboarding(false));
  }, [userId]);

  const fetchOpening = useCallback(async (mode: InputMode = 'voice', opts?: { sessionType?: SessionType; continueFrom?: string | null }) => {
    if (!userId || !onboardingComplete) return;
    if (viewRef.current !== 'voice') return;
    if (fetchingOpeningRef.current) return;
    fetchingOpeningRef.current = true;
    setOpeningLoading(true);
    setOpeningMessage(null);
    try {
      const isTextMode = mode === 'text';
      const st = opts?.sessionType ?? sessionType;
      const cf = opts?.continueFrom !== undefined ? opts.continueFrom : continueFromId;
      const sessionTypeParam = st === 'fresh' ? '&sessionType=fresh' : '';
      const continueParam = cf ? `&continueFrom=${cf}` : '';
      const url = `/api/conversation/opening?userId=${userId}${isTextMode ? '&skipTts=true' : ''}${sessionTypeParam}${continueParam}`;
      const r = await fetch(url);

      if (isTextMode) {
        // Text mode: expect JSON response
        const contentType = r.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
          const data = await r.json();
          if (data.conversationId) setConversationId(data.conversationId);
          if (data.marcusText) setOpeningMessage(data.marcusText);
        } else {
          // Fallback: audio response with headers
          const convId = r.headers.get('X-Conversation-Id');
          const marcusText = decodeURIComponent(r.headers.get('X-Marcus-Text') || '');
          if (convId) setConversationId(convId);
          if (marcusText) setOpeningMessage(marcusText);
        }
      } else {
        // Voice mode: expect audio response
        const convId = r.headers.get('X-Conversation-Id');
        const marcusText = decodeURIComponent(r.headers.get('X-Marcus-Text') || '');
        if (convId) setConversationId(convId);
        if (marcusText) setOpeningMessage(marcusText);
        const audioBuffer = await r.arrayBuffer();
        if (audioBuffer.byteLength > 0) {
          const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
          const blobUrl = URL.createObjectURL(blob);
          const audio = new Audio(blobUrl);
          audio.onended = () => URL.revokeObjectURL(blobUrl);
          audio.play().catch((e) => console.warn('Opening audio play error:', e));
        }
      }
      setRefreshSidebar((p) => p + 1);
    } catch (err) {
      console.error('Opening fetch error:', err);
    } finally {
      setOpeningLoading(false);
      fetchingOpeningRef.current = false;
    }
  }, [userId, onboardingComplete, sessionType, continueFromId]);

  // Enter the mic-open voice room. Shows the "listening" entry screen while Marcus's opening
  // loads, then flips to the room (effect below). sessionType/continueFrom are passed through
  // to fetchOpening so there is no stale-state race.
  const enterVoice = useCallback((opts: { sessionType: SessionType; continueFrom: string | null }) => {
    if (fetchingOpeningRef.current) return;
    setConversationId(null); setTranscripts([]); setOpeningMessage(null); setSessionNotes(null);
    setSelectedConvId(null); setSidebarOpen(false);
    setSessionType(opts.sessionType); setContinueFromId(opts.continueFrom);
    setExpandedSessionId(null); setRecentSessions([]); setStartLoading(false);
    setView('voice'); viewRef.current = 'voice';
    setInputMode('listening');
    void fetchOpening('voice', opts);
  }, [fetchOpening]);

  const handleStartFresh = useCallback(() => enterVoice({ sessionType: 'fresh', continueFrom: null }), [enterVoice]);

  // Once the opening is ready, move from the "listening" entry screen into the room.
  useEffect(() => {
    if (inputMode === 'listening' && openingMessage && !openingLoading) setInputMode('voice');
  }, [inputMode, openingMessage, openingLoading]);

  // The sign-up ends inside the conversation: once logged in AND past onboarding, a
  // just-authed user is dropped straight into the mic-open listening screen. It waits for
  // onboardingComplete, so it never fights the onboarding gate (new users still onboard first).
  useEffect(() => {
    if (userId && onboardingComplete && pendingEntry && viewRef.current !== 'voice') {
      setPendingEntry(false);
      enterVoice({ sessionType: 'fresh', continueFrom: null });
    }
  }, [userId, onboardingComplete, pendingEntry, enterVoice]);

  const handleSendCode = async () => {
    if (!email || !email.includes('@')) { setAuthError('Please enter a valid email.'); return; }
    setSendingCode(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/send-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Failed to send code'); return; }
      setAuthStep('otp');
      setOtpCode('');
    } catch { setAuthError('Network error. Please try again.'); }
    finally { setSendingCode(false); }
  };

  const handleVerifyCode = async () => {
    if (otpCode.length !== 6) { setAuthError('Please enter the 6-digit code.'); return; }
    setVerifyingCode(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Invalid code'); return; }
      setUserId(data.userId);
      setUserEmail(data.email);
      setInitialized(true);
      safeLocal.set('marcus_userId', data.userId);
      safeLocal.set('marcus_email', data.email);
      setShowLogin(false);
      setAuthStep('email');
    } catch { setAuthError('Network error. Please try again.'); }
    finally { setVerifyingCode(false); }
  };

  const handlePasswordLogin = async () => {
    if (!password) { setAuthError('Please enter your password.'); return; }
    setLoggingIn(true);
    setAuthError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setAuthError(data.error || 'Invalid credentials'); return; }
      setUserId(data.userId);
      setUserEmail(data.email);
      setInitialized(true);
      safeLocal.set('marcus_userId', data.userId);
      safeLocal.set('marcus_email', data.email);
      setShowLogin(false);
      setAuthStep('email');
      setPassword('');
    } catch { setAuthError('Network error. Please try again.'); }
    finally { setLoggingIn(false); }
  };

  const handleLogout = () => {
    safeLocal.remove('marcus_userId');
    safeLocal.remove('marcus_email');
    setUserId(null);
    setUserEmail(null);
    setInitialized(false);
    setOnboardingComplete(false);
    setConversationId(null);
    setTranscripts([]);
    setOpeningMessage(null);
    setSessionNotes(null);
    setView('analytics');
    setShowLogin(false);
    setEmail('');
  };

  // YOUR DATA level 3 — everything incl. memory. The typed-ERASE confirm lives in Settings.
  const handleStartOver = async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/auth/clean-slate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error('Failed');
      setConversationId(null); setTranscripts([]); setOpeningMessage(null); setSessionNotes(null);
      setSelectedConvId(null); setRefreshSidebar((p) => p + 1); setView('analytics');
    } catch (err) { console.error('Start over error:', err); }
  };

  // YOUR DATA level 2 — all conversations, memory kept.
  const handleDeleteAll = async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/conversations/delete-all', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error('Failed');
      setSelectedConvId(null); setRefreshSidebar((p) => p + 1); setView('analytics');
    } catch (err) { console.error('Delete all error:', err); }
  };

  const handleOpenSettings = () => { setSelectedConvId(null); setSessionNotes(null); setView('settings'); };

  // "Write" — enter text mode directly (the restored typed conversation).
  const handleWrite = () => {
    if (fetchingOpeningRef.current) return;
    setConversationId(null); setTranscripts([]); setOpeningMessage(null); setSessionNotes(null);
    setSelectedConvId(null); setSidebarOpen(false);
    setSessionType('fresh'); setContinueFromId(null);
    setExpandedSessionId(null); setRecentSessions([]); setStartLoading(false);
    setView('voice'); viewRef.current = 'voice';
    setInputMode('text');
    void fetchOpening('text', { sessionType: 'fresh', continueFrom: null });
  };

  const handleTranscript = useCallback((userText: string, marcusText: string, emotion?: string) => {
    setTranscripts((prev) => [...prev, { user: userText, marcus: marcusText, emotion }]);
    setRefreshSidebar((p) => p + 1);
  }, []);

  // Emotional register (0 = light .. 1 = heavy) for the ambient shader background. Primary
  // source is X-Emotion (the pipeline's one-word emotion, surfaced via onTranscript); when
  // it's absent / neutral / unrecognized we fall back to the lexical read of Marcus's reply.
  // Presentation only; touches nothing in the pipeline.
  const register = useMemo(() => {
    const last = transcripts.length ? transcripts[transcripts.length - 1] : null;
    if (!last) return 0;
    return emotionToRegister(last.emotion) ?? deriveRegister(last.marcus);
  }, [transcripts]);

  const handleNewSession = async () => {
    if (fetchingOpeningRef.current) return;
    if (conversationId && view === 'voice' && (transcripts.length > 0 || openingMessage)) return;
    setConversationId(null);
    setTranscripts([]);
    setOpeningMessage(null);
    setSessionNotes(null);
    setSelectedConvId(null);
    setSidebarOpen(false);
    setSessionType('continue');
    setContinueFromId(null);
    setExpandedSessionId(null);
    setRecentSessions([]);
    setView('voice');
    viewRef.current = 'voice';
    // The start fork only makes sense when a prior session exists. Decide by fetching recent
    // sessions FIRST: some -> show the Continue/fresh fork; none -> nothing to choose, go
    // straight to the listening state (fixes the "Continue offered with zero sessions" bug).
    setStartLoading(true);
    setInputMode('session-type');
    try {
      const res = await fetch(`/api/conversations/recent?userId=${userId}`);
      const data = await res.json();
      const sessions = data.sessions || [];
      setStartLoading(false);
      if (sessions.length > 0) setRecentSessions(sessions);
      else enterVoice({ sessionType: 'fresh', continueFrom: null });
    } catch {
      setStartLoading(false);
      enterVoice({ sessionType: 'fresh', continueFrom: null });
    }
  };

  // (Removed: handleChooseSessionType / handlePickSession / handleChooseMode — the dead
  //  session-type → pick-session → voice/text fork they drove is gone. "Talk" starts a voice
  //  session, "Write" enters text directly, and Continue is chosen on the editorial fork.)

  const sendTextMessage = async () => {
    if (!textInput.trim() || textSending || !userId) return;
    const message = textInput.trim();
    setTextInput('');
    setTextSending(true);
    setState('processing');
    try {
      const res = await fetch('/api/conversation/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, conversationId, message }),
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      if (data.conversationId && !conversationId) setConversationId(data.conversationId);
      setTranscripts((prev) => [...prev, { user: message, marcus: data.marcusText, emotion: data.emotion }]);
      setRefreshSidebar((p) => p + 1);
    } catch (err) {
      console.error('Text send error:', err);
    } finally {
      setTextSending(false);
      setState('idle');
    }
  };

  const handleEndSession = async () => {
    if (!conversationId || endingSession) return;
    setEndingSession(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, { method: 'POST' });
      const data = await res.json();
      setSessionNotes(data);
      setView('session-notes');
      setRefreshSidebar((p) => p + 1);
    } catch (err) {
      console.error('End session error:', err);
    } finally {
      setEndingSession(false);
    }
  };

  const handleGoToAnalytics = () => { setView('analytics'); setSelectedConvId(null); setSessionNotes(null); };
  const handleSelectSession = (id: string) => { setSelectedConvId(id); setView('session-detail'); setSidebarOpen(false); };

  // Continue a conversation directly from the dashboard — goes straight to voice/text choice
  const handleContinueSession = (sessionId: string) => {
    // Straight into the mic-open room, continuing that thread (no voice/text step).
    enterVoice({ sessionType: 'continue', continueFrom: sessionId });
  };

  const statusLabel: Record<VoiceState, string> = {
    idle: 'Tap the orb to speak', listening: 'Listening…', processing: 'Reflecting…', speaking: 'Marcus is speaking…',
  };

  // The single header component (AppHeader) is used on every screen — the old inline NavBar
  // and the old app-shell header are both replaced by it.

  // ─── Auth Loading ───
  if (authLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center relative gap-4">
        <div className="ambient-bg" />
        <div className="w-8 h-8 rounded-full border-2 border-[#b0611f]/20 border-t-[#b0611f] animate-spin" />
      </div>
    );
  }

  // ─── Landing Page (not logged in) ───
  if (!initialized || !userId) {
    // Cinematic intro plays once (persisted flag); reduced-motion / return visits skip it.
    if (!introDone) return <IntroSequence onDone={() => setIntroDone(true)} />;
    const enterCode = () => { setPendingEntry(true); handleVerifyCode(); };
    return (
      <div className="h-screen w-screen flex flex-col relative overflow-hidden" style={{ background: '#faf9f6' }}>
        <ShaderBackground contained state="idle" register={0} />
        {/* Header — wordmark + Sign in, nothing else */}
        <header className="relative z-20 flex-none">
          <div className="flex items-center justify-between px-6 sm:px-10 lg:px-16" style={{ height: 60 }}>
            <span style={{ fontSize: 13, letterSpacing: '0.3em', textTransform: 'uppercase', color: '#14100e', fontWeight: 500 }}>Markos</span>
            <button onClick={() => { setAuthStep('email'); document.getElementById('hero-email')?.focus(); }} className="transition-opacity hover:opacity-70" style={{ fontSize: 13, letterSpacing: '0.04em', color: '#5c534b' }}>Sign in</button>
          </div>
        </header>
        <div className="relative z-10 flex-1 overflow-y-auto">
          <div className="mx-auto w-full px-6 sm:px-10 lg:px-16" style={{ maxWidth: 640 }}>
            {/* Hero */}
            <div className="flex justify-center" style={{ marginTop: 24 }}>
              <Orb3D size={168} />
            </div>
            <p className="text-center" style={{ fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#6b6259', marginTop: 32 }}>A voice for what you don’t say</p>
            <h1 className="font-serif text-center" style={{ fontSize: 'clamp(30px,5.5vw,50px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.12, color: '#14100e', marginTop: 14, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>Most men don’t have anyone to say it to.</h1>
            <p className="text-center" style={{ fontSize: 18, lineHeight: 1.6, color: '#3d352e', marginTop: 20, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>Not therapy. Not a chatbot. A voice you can think out loud with — at 2am, when there’s no one else to call.</p>

            {/* Email field IN THE HERO (no separate signup page) */}
            <div className="mx-auto" style={{ maxWidth: 420, marginTop: 30 }}>
              {authStep !== 'otp' ? (
                <>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input id="hero-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setAuthError(''); }} onKeyDown={(e) => e.key === 'Enter' && handleSendCode()} placeholder="you@email.com" disabled={sendingCode}
                      style={{ flex: 1, height: 48, padding: '0 16px', background: '#faf9f6', border: '1px solid #ded8cf', borderRadius: 0, color: '#14100e', fontSize: 16 }} />
                    <button onClick={handleSendCode} disabled={sendingCode} className="disabled:opacity-50" style={{ height: 48, padding: '0 22px', background: '#14100e', color: '#faf9f6', borderRadius: 0, fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap' }}>{sendingCode ? 'Sending…' : 'Continue'}</button>
                  </div>
                  <p className="text-center" style={{ fontSize: 13, color: '#6b6259', marginTop: 12 }}>We’ll send a code. No password, no card.</p>
                </>
              ) : (
                <>
                  <p className="text-center" style={{ fontSize: 14, color: '#5c534b', marginBottom: 10 }}>Code sent to {email}</p>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input type="text" inputMode="numeric" maxLength={6} value={otpCode} onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setAuthError(''); }} onKeyDown={(e) => e.key === 'Enter' && otpCode.length === 6 && enterCode()} placeholder="6-digit code" className="font-mono"
                      style={{ flex: 1, height: 48, padding: '0 16px', background: '#faf9f6', border: '1px solid #ded8cf', borderRadius: 0, color: '#14100e', fontSize: 18, letterSpacing: '0.3em', textAlign: 'center' }} />
                    <button onClick={enterCode} disabled={verifyingCode || otpCode.length !== 6} className="disabled:opacity-50" style={{ height: 48, padding: '0 22px', background: '#14100e', color: '#faf9f6', borderRadius: 0, fontSize: 15, fontWeight: 500, whiteSpace: 'nowrap' }}>{verifyingCode ? 'Verifying…' : 'Enter'}</button>
                  </div>
                  <div className="text-center" style={{ marginTop: 12 }}>
                    <button onClick={handleSendCode} disabled={sendingCode} className="transition-opacity hover:opacity-70" style={{ fontSize: 13, color: '#8a4a14' }}>{sendingCode ? 'Sending…' : 'Resend code'}</button>
                    <span style={{ color: '#6b6259', margin: '0 10px' }}>·</span>
                    <button onClick={() => { setAuthStep('email'); setOtpCode(''); setAuthError(''); }} className="transition-opacity hover:opacity-70" style={{ fontSize: 13, color: '#6b6259' }}>Change email</button>
                  </div>
                </>
              )}
              {authError && <p className="text-center" style={{ fontSize: 13, color: '#8a4a14', marginTop: 10 }}>{authError}</p>}
            </div>

            {/* A four-line sample exchange — instead of feature cards */}
            <div style={{ marginTop: 72, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
              {[
                { who: 'You', serif: false, text: 'I don’t even know why I’m saying this out loud.' },
                { who: 'Marcus', serif: true, text: 'Say it anyway. Out loud it’s smaller than it is in your head.' },
                { who: 'You', serif: false, text: 'Everyone thinks I’ve got it handled.' },
                { who: 'Marcus', serif: true, text: 'You don’t have to have it handled with me. What’s the part you haven’t put down?' },
              ].map((m, i) => (
                <div key={i} style={{ marginTop: i === 0 ? 0 : 22 }}>
                  <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#6b6259' }}>{m.who}</p>
                  <p className={m.serif ? 'font-serif' : ''} style={{ fontSize: m.serif ? 19 : 17, lineHeight: 1.55, color: m.serif ? '#3d352e' : '#14100e', marginTop: 5 }}>{m.text}</p>
                </div>
              ))}
            </div>

            {/* Three sentences — instead of a feature grid */}
            <div style={{ marginTop: 60, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
              {[
                'You talk, and he listens — no advice you didn’t ask for.',
                'He remembers what you told him, so you’re never starting over.',
                'He’s read what lasts — Marcus Aurelius, Seneca — and speaks plainly from it.',
              ].map((s, i) => (
                <p key={i} style={{ fontSize: 18, lineHeight: 1.55, color: '#3d352e', marginTop: i === 0 ? 0 : 16 }}>{s}</p>
              ))}
            </div>
          </div>
          {/* Footer */}
          <footer className="text-center" style={{ padding: '52px 24px 34px' }}>
            <p style={{ fontSize: 13, color: '#6b6259' }}>Not a crisis service. If you’re in danger, call 988.</p>
          </footer>
        </div>
      </div>
    );
  }
  // ─── Checking Onboarding ───
  if (checkingOnboarding) {
    return (
      <div className="h-screen flex flex-col items-center justify-center relative gap-4">
        <div className="ambient-bg" />
        <div className="w-8 h-8 rounded-full border-2 border-[#b0611f]/20 border-t-[#b0611f] animate-spin" />
        <p className="text-xs text-muted-foreground/60">Preparing your session…</p>
      </div>
    );
  }

  // ─── Onboarding ───
  if (!onboardingComplete) {
    return (
      <div className="relative">
        <div className="ambient-bg" />
        <AppHeader mode="focused" />
        <div className="relative z-10">
          <OnboardingFlow userId={userId} onComplete={() => setOnboardingComplete(true)} />
        </div>
      </div>
    );
  }

  // ─── Voice mode — full-screen immersive room (its own view, no chat-shell chrome) ───
  // Layout-only: when the user is in a live voice session, render the voice room INSTEAD
  // of the header + sidebar + chat shell below. Text/chat and every other view keep the
  // shell unchanged. No state or handler changes — same VoiceOrb mount, same handlers.
  if (view === 'voice' && inputMode === 'voice') {
    return (
      <div className="h-screen w-screen flex flex-col relative overflow-hidden" style={{ background: '#faf9f6' }}>
        {/* Ambient Paper Shaders backdrop — driven by conversation state + a slow
            emotional register. Presentation only; sits behind all content (z-0). */}
        <ShaderBackground state={state} register={register} />
        <AppHeader mode="focused" onHome={handleGoToAnalytics} onClose={handleGoToAnalytics} />

        {/* Session row — prototype's single flex:1 align-items:center row; content centered */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-6 sm:px-10 lg:px-16 py-9 min-h-0" style={{ borderBottom: '2px solid #14100e' }}>
          <div className="flex items-center gap-8 sm:gap-11 w-full" style={{ maxWidth: 860 }}>
            <div className="relative flex-none flex items-center justify-center">
              <VoiceOrb
                onStateChange={(s) => { if (s === 'listening') setVoiceError(null); setState(s); }}
                onTranscript={handleTranscript}
                onError={setVoiceError}
                userId={userId}
                conversationId={conversationId}
                onConversationId={setConversationId}
                state={state}
                disabled={state === 'processing' || state === 'speaking'}
                handsFree={handsFree}
                muted={muted}
              />
            </div>
            <div className="flex-1 min-w-0">
              <span
                className="block"
                style={{ fontSize: 9, letterSpacing: '.26em', textTransform: 'uppercase',
                  color: (state === 'listening' || state === 'processing') ? '#6b6259' : '#b0611f' }}
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
                <p className="font-serif" style={{ margin: '22px 0 0', fontSize: 19, fontStyle: 'italic', color: '#8c8378' }}>
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
                <p style={{ margin: '14px 0 0', fontSize: 12, color: '#b0611f', maxWidth: 420 }}>{voiceError}</p>
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
                className="ml-1 text-[10px] font-medium uppercase tracking-[.14em] transition-opacity hover:opacity-70"
                style={{ color: handsFree ? '#b0611f' : '#6b6259' }}
                title={handsFree ? 'Switch to tap-to-talk' : 'Switch to hands-free'}
              >
                · {handsFree ? 'hands-free' : 'tap to talk'}
              </button>
              {/* Manual mute — pause the mic mid-session without ending it */}
              {handsFree && (
                <button
                  onClick={() => setMuted((v) => !v)}
                  className="ml-1 text-[10px] font-medium uppercase tracking-[.14em] transition-opacity hover:opacity-70"
                  style={{ color: muted ? '#b0611f' : '#6b6259' }}
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
                style={{ color: showTranscript ? '#b0611f' : '#5c534b' }}
                aria-pressed={showTranscript}
              >
                <MessageSquare className="w-3.5 h-3.5" /> Transcript
              </button>
              {(transcripts.length > 0 || openingMessage) && conversationId && (
                <button
                  onClick={handleEndSession}
                  disabled={endingSession}
                  className="flex items-center gap-2 h-[38px] px-4 text-[10.5px] font-semibold uppercase tracking-[.14em] text-[#14100e] border-2 border-[#14100e] hover:bg-[#14100e] hover:text-[#faf9f6] transition-colors disabled:opacity-50"
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
                    <span style={{ fontSize: 9, letterSpacing: '.24em', textTransform: 'uppercase', color: '#b0611f' }}>Marcus</span>
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
                      <span style={{ fontSize: 9, letterSpacing: '.24em', textTransform: 'uppercase', color: '#b0611f' }}>Marcus</span>
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

  // ─── Main App (logged in) ───
  return (
    <div className="h-screen w-screen flex flex-col relative overflow-hidden" style={{ background: '#faf9f6' }}>
      {/* ONE ShaderBackground for the whole logged-in shell — runs to the top edge behind the
          transparent header; every view below is transparent and sits over it. */}
      <ShaderBackground contained state="idle" register={0} />
      <AppHeader
        mode={view === 'settings' || view === 'voice' ? 'focused' : 'full'}
        active={view === 'analytics' ? 'sessions' : null}
        email={userEmail}
        onHome={handleGoToAnalytics}
        onSessions={handleGoToAnalytics}
        onTalk={handleNewSession}
        onWrite={handleWrite}
        onSettings={handleOpenSettings}
        onClose={handleGoToAnalytics}
      />

      {/* Body */}
      <div className="flex-1 flex relative z-10 overflow-hidden">
        {/* Session rail only while reading one past session */}
        {view === 'session-detail' && selectedConvId && (
          <Sidebar
            userId={userId}
            onSelectSession={handleSelectSession}
            activeSessionId={selectedConvId}
            onNewSession={handleNewSession}
            refreshTrigger={refreshSidebar}
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden">
          {view === 'session-detail' && selectedConvId ? (
            <ConversationView conversationId={selectedConvId} onBack={handleGoToAnalytics} />
          ) : view === 'settings' ? (
            <SettingsScreen email={userEmail} handsFree={handsFree} onToggleHandsFree={setHandsFree} onSignOut={handleLogout} onDeleteAll={handleDeleteAll} onStartOver={handleStartOver} />
          ) : view === 'analytics' ? (
            <AnalyticsDashboard userId={userId} onSelectSession={handleSelectSession} onContinueSession={handleContinueSession} onStartFresh={handleStartFresh} />
          ) : view === 'session-notes' && sessionNotes ? (
            /* ─── Session Notes (post end-session) ─── */
            <div className="relative flex-1 overflow-hidden">
              <div className="relative z-10 h-full overflow-y-auto">
                <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 py-16" style={{ maxWidth: 720 }}>
                  <SessionSummary
                    title={sessionNotes.title || 'Session complete'}
                    dateLabel="Today"
                    summary={sessionNotes.summary}
                    takeaways={sessionNotes.takeaways}
                    ponderingTopics={sessionNotes.pondering_topics}
                    stoicPrinciple={sessionNotes.stoic_principle}
                  />
                  <button
                    onClick={handleGoToAnalytics}
                    className="inline-flex items-center gap-2 transition-opacity hover:opacity-70"
                    style={{ color: '#6b6259', fontSize: 15, marginTop: 52 }}
                  >
                    <History className="w-4 h-4" strokeWidth={1.75} /> Back to sessions
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ─── Session UI ─── */
            <div className="flex-1 flex flex-col h-full">
              {/* Mode Selection */}
              {/* Session-start (a prior session exists) — editorial fork: Continue first + warmer */}
              {inputMode === 'session-type' && !openingMessage && !openingLoading && transcripts.length === 0 && (
                <div className="relative flex-1 overflow-hidden">
                  <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 fade-in-up">
                    {startLoading || recentSessions.length === 0 ? (
                      <p style={{ fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#6b6259' }}>One moment…</p>
                    ) : (
                      <div className="w-full" style={{ maxWidth: 520 }}>
                        <div className="flex justify-center">
                          <Orb3D size={132} />
                        </div>
                        <h1 className="font-serif text-center" style={{ fontSize: 'clamp(28px,4.5vw,42px)', fontWeight: 400, letterSpacing: '-0.02em', color: '#14100e', marginTop: 34 }}>Where do you want to start?</h1>
                        <div style={{ marginTop: 40 }}>
                          {/* Continue — first, warmer, and it NAMES what is being continued */}
                          <button onClick={() => handleContinueSession(recentSessions[0].id)} className="block w-full text-left transition-opacity hover:opacity-80">
                            <p style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8a4a14' }}>{`Continue · ${relDayUpper(recentSessions[0].date)}`}</p>
                            <p style={{ fontSize: 22, color: '#14100e', marginTop: 6, lineHeight: 1.3 }}>{recentSessions[0].title}</p>
                            {recentSessions[0].lastUserMessage && (
                              <p style={{ fontSize: 15, color: '#5c534b', marginTop: 6, fontStyle: 'italic', lineHeight: 1.45 }}>&ldquo;{clip(recentSessions[0].lastUserMessage, 92)}&rdquo;</p>
                            )}
                          </button>
                          {/* Something else — quieter */}
                          <button onClick={handleStartFresh} className="block w-full text-left transition-opacity hover:opacity-70" style={{ marginTop: 30 }}>
                            <p style={{ fontSize: 16, color: '#5c534b' }}>Something else — <span style={{ color: '#6b6259' }}>start fresh, Marcus still knows you.</span></p>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Session-start (no prior session) — no buttons; the mic is already open */}
              {inputMode === 'listening' && (
                <div className="relative flex-1 overflow-hidden">
                  <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6 fade-in-up">
                    <Orb3D size={168} />
                    <h1 className="font-serif" style={{ fontSize: 'clamp(30px,5vw,46px)', fontWeight: 400, letterSpacing: '-0.02em', color: '#14100e', marginTop: 40 }}>I&rsquo;m here.</h1>
                    <p style={{ fontSize: 18, color: '#5c534b', marginTop: 14 }}>Start talking whenever you&rsquo;re ready.</p>
                    <p style={{ position: 'absolute', bottom: 36, fontSize: 12, letterSpacing: '0.26em', textTransform: 'uppercase', color: '#6b6259' }}>Listening</p>
                  </div>
                </div>
              )}

              {/* (Removed dead pick-session + voice/text choice blocks — Talk/Write/Continue
                  now route directly; nothing sets those inputModes.) */}

              {/* Voice mode is a full-screen view rendered above (the `view === 'voice' &&
                  inputMode === 'voice'` early return); it is intentionally NOT rendered
                  inside the chat shell, so the sidebar/header don't compete with it. */}

              {/* Write — text mode, on the system: YOU in sans, MARCUS in serif, editorial composer */}
              {inputMode === 'text' && (
                <div className="relative z-10 flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto">
                    <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 py-10 fade-in-up" style={{ maxWidth: 680 }}>
                      {openingLoading && <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#6b6259', opacity: 0.6 }}>One moment…</p>}
                      {openingMessage && !openingLoading && (
                        <div>
                          <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#6b6259' }}>Marcus</p>
                          <p className="font-serif" style={{ fontSize: 20, lineHeight: 1.55, color: '#3d352e', marginTop: 6 }}>{openingMessage}</p>
                        </div>
                      )}
                      {transcripts.map((t, i) => (
                        <div key={i} style={{ marginTop: i === 0 && !openingMessage ? 0 : 30 }}>
                          <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#6b6259' }}>You</p>
                          <p style={{ fontSize: 18, lineHeight: 1.55, color: '#14100e', marginTop: 6 }}>{t.user}</p>
                          <div style={{ marginTop: 22 }}>
                            <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#6b6259' }}>Marcus</p>
                            <p className="font-serif" style={{ fontSize: 20, lineHeight: 1.55, color: '#3d352e', marginTop: 6 }}>{t.marcus}</p>
                          </div>
                        </div>
                      ))}
                      {state === 'processing' && <p style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#6b6259', opacity: 0.6, marginTop: 26 }}>Reflecting…</p>}
                      <div ref={messagesEndRef} />
                    </div>
                  </div>
                  <div className="flex-none">
                    <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 py-5" style={{ maxWidth: 680 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <input
                          value={textInput}
                          onChange={(e) => setTextInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendTextMessage()}
                          placeholder={state === 'processing' ? 'Marcus is thinking…' : 'Write to Marcus…'}
                          disabled={textSending || state === 'processing' || state === 'speaking'}
                          style={{ flex: 1, height: 46, padding: '0 16px', background: '#faf9f6', border: '1px solid #ded8cf', color: '#14100e', fontSize: 16 }}
                        />
                        <button onClick={sendTextMessage} disabled={textSending || !textInput.trim() || state === 'processing' || state === 'speaking'} className="disabled:opacity-40" style={{ height: 46, width: 46, background: '#14100e', color: '#faf9f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {textSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                      </div>
                      {(transcripts.length > 0 || openingMessage) && conversationId && (
                        <button onClick={handleEndSession} disabled={endingSession} className="disabled:opacity-50" style={{ fontSize: 13, color: '#5c534b', marginTop: 12 }}>
                          {endingSession ? 'Ending…' : 'End session'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}