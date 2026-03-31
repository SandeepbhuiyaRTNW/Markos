'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, History, Plus, Menu, X, Loader2, Send, ChevronRight, LogOut, Shield, BookOpen, Brain, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import VoiceOrb from '@/components/VoiceOrb';
import OnboardingFlow from '@/components/OnboardingFlow';
import ConversationView from '@/components/ConversationView';
import Sidebar from '@/components/Sidebar';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';
type AppView = 'analytics' | 'voice' | 'session-detail' | 'session-notes';

interface SessionNotesData {
  title?: string;
  summary?: string;
  takeaways?: string[];
  pondering_topics?: string[];
  mood?: string;
  stoic_principle?: string;
  topics?: string[];
}

interface Transcript {
  user: string;
  marcus: string;
}

export default function Home() {
  const [state, setState] = useState<VoiceState>('idle');
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
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
  const [textInput, setTextInput] = useState('');
  const [sessionNotes, setSessionNotes] = useState<SessionNotesData | null>(null);
  const [endingSession, setEndingSession] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [authStep, setAuthStep] = useState<'email' | 'otp'>('email');
  const [otpCode, setOtpCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fetchingOpeningRef = useRef(false);
  const viewRef = useRef<AppView>(view);
  viewRef.current = view;

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedId = localStorage.getItem('marcus_userId');
    const savedEmail = localStorage.getItem('marcus_email');
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

  const fetchOpening = useCallback(async () => {
    if (!userId || !onboardingComplete) return;
    if (viewRef.current !== 'voice') return;
    if (fetchingOpeningRef.current) return;
    fetchingOpeningRef.current = true;
    setOpeningLoading(true);
    setOpeningMessage(null);
    try {
      const r = await fetch(`/api/conversation/opening?userId=${userId}`);
      const convId = r.headers.get('X-Conversation-Id');
      const marcusText = decodeURIComponent(r.headers.get('X-Marcus-Text') || '');
      if (convId) setConversationId(convId);
      if (marcusText) setOpeningMessage(marcusText);
      setRefreshSidebar((p) => p + 1);
      const audioBuffer = await r.arrayBuffer();
      if (audioBuffer.byteLength > 0) {
        const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play().catch((e) => console.warn('Opening audio play error:', e));
      }
    } catch (err) {
      console.error('Opening fetch error:', err);
    } finally {
      setOpeningLoading(false);
      fetchingOpeningRef.current = false;
    }
  }, [userId, onboardingComplete]);

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
      localStorage.setItem('marcus_userId', data.userId);
      localStorage.setItem('marcus_email', data.email);
      setShowLogin(false);
      setAuthStep('email');
    } catch { setAuthError('Network error. Please try again.'); }
    finally { setVerifyingCode(false); }
  };

  const handleLogout = () => {
    localStorage.removeItem('marcus_userId');
    localStorage.removeItem('marcus_email');
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

  const handleTranscript = useCallback((userText: string, marcusText: string) => {
    setTranscripts((prev) => [...prev, { user: userText, marcus: marcusText }]);
    setRefreshSidebar((p) => p + 1);
  }, []);

  const handleNewSession = () => {
    if (fetchingOpeningRef.current) return;
    if (conversationId && view === 'voice' && (transcripts.length > 0 || openingMessage)) return;
    setConversationId(null);
    setTranscripts([]);
    setOpeningMessage(null);
    setSessionNotes(null);
    setSelectedConvId(null);
    setSidebarOpen(false);
    setView('voice');
    viewRef.current = 'voice';
    fetchOpening();
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

  const statusLabel: Record<VoiceState, string> = {
    idle: 'Tap the orb to speak', listening: 'Listening…', processing: 'Reflecting…', speaking: 'Marcus is speaking…',
  };

  // ─── Global Nav Bar (always visible) ───
  const NavBar = ({ transparent }: { transparent?: boolean }) => (
    <header className={`relative z-30 sticky top-0 ${transparent ? 'bg-transparent' : 'bg-white border-b border-border'}`}>
      <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#a3785e]/12 to-[#a3785e]/4 border border-[#a3785e]/15 flex items-center justify-center">
            <span className="text-lg font-light text-[#a3785e]">M</span>
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground leading-tight">mrkos.ai</h1>
            <p className="text-[11px] text-muted-foreground/60">Stoic Companion</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {initialized && userId ? (
            <>
              <span className="text-xs text-muted-foreground hidden sm:inline">{userEmail}</span>
              <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all">
                <LogOut className="w-3.5 h-3.5" /> Log out
              </button>
            </>
          ) : (
            <button onClick={() => setShowLogin(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#44403c] hover:bg-[#57534e] text-white transition-all shadow-sm">
              Log in
            </button>
          )}
        </div>
      </div>
    </header>
  );

  // ─── Auth Loading ───
  if (authLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center relative gap-4">
        <div className="ambient-bg" />
        <div className="w-8 h-8 rounded-full border-2 border-[#a3785e]/20 border-t-[#a3785e] animate-spin" />
      </div>
    );
  }

  // ─── Landing Page (not logged in) ───
  if (!initialized || !userId) {
    return (
      <div className="h-screen flex flex-col relative overflow-y-auto">
        <div className="ambient-bg" />
        <NavBar transparent />
        <div className="relative z-10 flex-1">
          {/* Hero Section */}
          <section className="max-w-4xl mx-auto px-6 pt-16 pb-20 text-center fade-in-up">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-[#a3785e]/15 to-[#a3785e]/5 border border-[#a3785e]/20 flex items-center justify-center mx-auto mb-8">
              <span className="text-5xl font-light text-[#a3785e]">M</span>
            </div>
            <h2 className="text-5xl sm:text-6xl font-semibold tracking-tight text-foreground mb-4 leading-tight">
              Your Stoic<br />Companion
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
              Marcus is an AI embodiment of Marcus Aurelius — a voice-first companion for men navigating
              work, relationships, identity, and purpose through Stoic wisdom.
            </p>

            {showLogin ? (
              <div className="max-w-sm mx-auto space-y-4 fade-in-scale">
                {authStep === 'email' ? (
                  <>
                    <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setAuthError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                      placeholder="Enter your email"
                      className="h-13 bg-white border-border text-foreground placeholder:text-muted-foreground/60 rounded-xl px-5 text-sm" />
                    <Button onClick={handleSendCode} disabled={sendingCode}
                      className="w-full h-13 text-sm font-medium rounded-xl bg-[#44403c] hover:bg-[#57534e] text-white transition-all disabled:opacity-50">
                      {sendingCode ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending code…</> : <>Send Verification Code <ChevronRight className="w-4 h-4 ml-2" /></>}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">Code sent to <span className="font-medium text-foreground">{email}</span></p>
                    <Input type="text" inputMode="numeric" maxLength={6} value={otpCode}
                      onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setAuthError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && otpCode.length === 6 && handleVerifyCode()}
                      placeholder="Enter 6-digit code"
                      className="h-13 bg-white border-border text-foreground placeholder:text-muted-foreground/60 rounded-xl px-5 text-sm text-center tracking-[0.3em] text-lg font-mono" />
                    <Button onClick={handleVerifyCode} disabled={verifyingCode || otpCode.length !== 6}
                      className="w-full h-13 text-sm font-medium rounded-xl bg-[#44403c] hover:bg-[#57534e] text-white transition-all disabled:opacity-50">
                      {verifyingCode ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying…</> : <>Verify & Sign In <ChevronRight className="w-4 h-4 ml-2" /></>}
                    </Button>
                    <div className="flex items-center justify-center gap-4">
                      <button onClick={handleSendCode} disabled={sendingCode} className="text-xs text-[#a3785e] hover:text-[#8a6550] transition-colors disabled:opacity-50">
                        {sendingCode ? 'Sending…' : 'Resend code'}
                      </button>
                      <span className="text-muted-foreground/30">·</span>
                      <button onClick={() => { setAuthStep('email'); setOtpCode(''); setAuthError(''); }} className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                        Change email
                      </button>
                    </div>
                  </>
                )}
                {authError && <p className="text-xs text-red-500 text-center">{authError}</p>}
                <button onClick={() => { setShowLogin(false); setAuthStep('email'); setOtpCode(''); setAuthError(''); }}
                  className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setShowLogin(true)}
                className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl text-base font-bold bg-[#44403c] hover:bg-[#57534e] text-white transition-all shadow-lg hover:shadow-xl">
                Start Your Journey <ArrowRight className="w-5 h-5" />
              </button>
            )}
          </section>

          {/* Features */}
          <section className="max-w-4xl mx-auto px-6 pb-20">
            <div className="grid sm:grid-cols-3 gap-6">
              <div className="glass-strong rounded-2xl p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#a3785e]/8 flex items-center justify-center mx-auto mb-4">
                  <Mic className="w-6 h-6 text-[#a3785e]/60" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Voice-First</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">Speak naturally. Marcus listens deeply and responds with the weight of 2,000 years of Stoic wisdom.</p>
              </div>
              <div className="glass-strong rounded-2xl p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#a3785e]/8 flex items-center justify-center mx-auto mb-4">
                  <BookOpen className="w-6 h-6 text-[#a3785e]/60" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Stoic Library</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">Draws from Meditations, Seneca, Epictetus, Frankl, and more — woven into every conversation.</p>
              </div>
              <div className="glass-strong rounded-2xl p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#a3785e]/8 flex items-center justify-center mx-auto mb-4">
                  <Brain className="w-6 h-6 text-[#a3785e]/60" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-2">Remembers You</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">Marcus remembers your struggles, patterns, and growth — each session builds on the last.</p>
              </div>
            </div>
          </section>

          {/* Quote */}
          <section className="max-w-2xl mx-auto px-6 pb-20 text-center">
            <div className="glass-strong rounded-2xl p-8 border-[#a3785e]/10">
              <p className="text-base italic text-foreground/70 leading-relaxed mb-3">
                &quot;Waste no more time arguing about what a good man should be. Be one.&quot;
              </p>
              <p className="text-xs text-muted-foreground/50">— Marcus Aurelius, Meditations</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ─── Checking Onboarding ───
  if (checkingOnboarding) {
    return (
      <div className="h-screen flex flex-col items-center justify-center relative gap-4">
        <div className="ambient-bg" />
        <div className="w-8 h-8 rounded-full border-2 border-[#a3785e]/20 border-t-[#a3785e] animate-spin" />
        <p className="text-xs text-muted-foreground/60">Preparing your session…</p>
      </div>
    );
  }

  // ─── Onboarding ───
  if (!onboardingComplete) {
    return (
      <div className="relative">
        <div className="ambient-bg" />
        <NavBar />
        <div className="relative z-10">
          <OnboardingFlow userId={userId} onComplete={() => setOnboardingComplete(true)} />
        </div>
      </div>
    );
  }

  // ─── Main App (logged in) ───
  return (
    <div className="h-screen flex flex-col relative">
      <div className="ambient-bg" />

      {/* App Header */}
      <header className="relative z-20 border-b border-border bg-white sticky top-0">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setSidebarOpen(!sidebarOpen)}>
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#a3785e]/12 to-[#a3785e]/4 border border-[#a3785e]/15 flex items-center justify-center">
              <span className="text-lg font-light text-[#a3785e]">M</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground leading-tight">mrkos.ai</h1>
              <p className="text-[11px] text-muted-foreground/60">Stoic Companion</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleGoToAnalytics}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all border ${
                view === 'analytics' || view === 'session-detail' ? 'bg-white text-foreground shadow-sm border-border' : 'text-muted-foreground hover:text-foreground border-transparent hover:border-border'
              }`}>
              <History className="w-3.5 h-3.5" /><span className="hidden sm:inline">Sessions</span>
            </button>
            <button onClick={handleNewSession} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-[#44403c] hover:bg-[#57534e] text-white transition-all shadow-sm">
              <Plus className="w-4 h-4" /> New Session
            </button>
            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-border ml-1">
              <span className="text-[11px] text-muted-foreground">{userEmail}</span>
              <button onClick={handleLogout} className="text-muted-foreground/50 hover:text-foreground transition-colors" title="Log out"><LogOut className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex relative z-10 overflow-hidden">
        <Sidebar
          userId={userId}
          onSelectSession={handleSelectSession}
          activeSessionId={selectedConvId}
          onNewSession={handleNewSession}
          refreshTrigger={refreshSidebar}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
        />

        <main className="flex-1 flex flex-col overflow-hidden">
          {view === 'session-detail' && selectedConvId ? (
            <ConversationView conversationId={selectedConvId} onBack={handleGoToAnalytics} />
          ) : view === 'analytics' ? (
            <AnalyticsDashboard userId={userId} onSelectSession={handleSelectSession} />
          ) : view === 'session-notes' && sessionNotes ? (
            /* ─── Session Notes (post end-session) ─── */
            <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-8">
              <div className="max-w-2xl mx-auto space-y-6 fade-in-up">
                <div className="text-center mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#a3785e]/15 to-[#a3785e]/5 border border-[#a3785e]/20 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl font-light text-[#a3785e]">M</span>
                  </div>
                  <h2 className="text-xl font-semibold text-foreground">{sessionNotes.title || 'Session Complete'}</h2>
                  {sessionNotes.mood && (
                    <p className="text-xs text-muted-foreground/50 mt-1 uppercase tracking-wider">
                      Mood: {sessionNotes.mood}
                    </p>
                  )}
                </div>

                {/* Summary */}
                {sessionNotes.summary && (
                  <div className="glass-strong rounded-2xl p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#a3785e] mb-2">Summary</p>
                    <p className="text-sm leading-relaxed text-foreground/80">{sessionNotes.summary}</p>
                  </div>
                )}

                {/* Takeaways */}
                {sessionNotes.takeaways && sessionNotes.takeaways.length > 0 && (
                  <div className="glass-strong rounded-2xl p-5">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#a3785e] mb-3">Key Takeaways</p>
                    <ul className="space-y-2">
                      {sessionNotes.takeaways.map((t, i) => (
                        <li key={i} className="flex gap-2.5 text-sm text-foreground/80">
                          <span className="text-[#a3785e]/60 mt-0.5">→</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Pondering Topics */}
                {sessionNotes.pondering_topics && sessionNotes.pondering_topics.length > 0 && (
                  <div className="glass-strong rounded-2xl p-5 border border-[#a3785e]/10">
                    <p className="text-xs font-semibold uppercase tracking-widest text-[#a3785e] mb-3">Before Next Session — Ponder These</p>
                    <div className="space-y-3">
                      {sessionNotes.pondering_topics.map((t, i) => (
                        <div key={i} className="flex gap-2.5 text-sm text-muted-foreground italic">
                          <span className="text-[#a3785e]/50 mt-0.5 not-italic">✦</span>
                          <span>{t}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stoic Principle */}
                {sessionNotes.stoic_principle && (
                  <div className="text-center py-4">
                    <p className="text-[11px] text-muted-foreground/40 uppercase tracking-wider mb-1">Stoic Principle</p>
                    <p className="text-sm font-medium text-foreground/70">{sessionNotes.stoic_principle}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="pt-4">
                  <button
                    onClick={handleGoToAnalytics}
                    className="w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-medium border border-border text-foreground/70 hover:bg-secondary transition-all"
                  >
                    <History className="w-4 h-4" />
                    Back to Dashboard
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ─── Voice UI ─── */
            <div className="flex-1 flex flex-col h-full">
              {/* Chat-style transcript area */}
              <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6">
                <div className="max-w-2xl mx-auto space-y-4">
                  {/* Opening message from Marcus */}
                  {openingLoading && (
                    <div className="flex justify-start fade-in">
                      <div className="marcus-message message-bubble">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-[#a3785e] rounded-full animate-bounce" />
                          <div className="w-1.5 h-1.5 bg-[#a3785e] rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                          <div className="w-1.5 h-1.5 bg-[#a3785e] rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  {openingMessage && !openingLoading && (
                    <div className="flex justify-start fade-in">
                      <div className="marcus-message message-bubble">
                        <p className="text-sm leading-relaxed">{openingMessage}</p>
                      </div>
                    </div>
                  )}

                  {/* Conversation transcript */}
                  {transcripts.map((t, i) => (
                    <div key={i} className="space-y-3 fade-in">
                      <div className="flex justify-end">
                        <div className="user-message message-bubble">
                          <p className="text-sm leading-relaxed">{t.user}</p>
                        </div>
                      </div>
                      <div className="flex justify-start">
                        <div className="marcus-message message-bubble">
                          <p className="text-sm leading-relaxed">{t.marcus}</p>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Processing indicator */}
                  {state === 'processing' && (
                    <div className="flex justify-start fade-in">
                      <div className="marcus-message message-bubble">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-[#a3785e] rounded-full animate-bounce" />
                          <div className="w-1.5 h-1.5 bg-[#a3785e] rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                          <div className="w-1.5 h-1.5 bg-[#a3785e] rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {!openingMessage && !openingLoading && transcripts.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-center fade-in-up">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#a3785e]/10 to-transparent border border-[#a3785e]/10 flex items-center justify-center mb-6">
                        <Mic className="w-7 h-7 text-[#a3785e]/40" />
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">Ready when you are</p>
                      <p className="text-xs text-muted-foreground/50">Tap the orb below or type a message</p>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Bottom controls */}
              <div className="border-t border-border bg-white px-4 lg:px-8 py-4">
                <div className="max-w-2xl mx-auto">
                  {/* Voice Orb + Status */}
                  <div className="flex flex-col items-center gap-3 mb-4">
                    <VoiceOrb
                      onStateChange={setState}
                      onTranscript={handleTranscript}
                      userId={userId}
                      conversationId={conversationId}
                      onConversationId={setConversationId}
                      state={state}
                    />
                    <p className="text-[11px] tracking-wider uppercase text-muted-foreground/50">
                      {statusLabel[state]}
                    </p>
                  </div>
                  {/* End Session button — only visible when there are transcripts */}
                  {(transcripts.length > 0 || openingMessage) && conversationId && (
                    <div className="flex justify-center mt-2">
                      <button
                        onClick={handleEndSession}
                        disabled={endingSession}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-all disabled:opacity-50"
                      >
                        {endingSession ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Ending session…</>
                        ) : (
                          <><Send className="w-3.5 h-3.5" /> End Session</>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}