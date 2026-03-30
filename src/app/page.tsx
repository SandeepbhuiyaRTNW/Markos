'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Mic, History, Plus, Menu, X, Loader2, Send, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import VoiceOrb from '@/components/VoiceOrb';
import OnboardingFlow from '@/components/OnboardingFlow';
import ConversationView from '@/components/ConversationView';
import Sidebar from '@/components/Sidebar';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';

type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';
type AppView = 'analytics' | 'voice' | 'session-detail';

interface Transcript {
  user: string;
  marcus: string;
}

export default function Home() {
  const [state, setState] = useState<VoiceState>('idle');
  const [userId, setUserId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [email, setEmail] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(false);
  const [openingMessage, setOpeningMessage] = useState<string | null>(null);
  const [openingLoading, setOpeningLoading] = useState(false);
  const [view, setView] = useState<AppView>('voice');
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [refreshSidebar, setRefreshSidebar] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [sessionTrigger, setSessionTrigger] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  // Fetch Marcus opening message whenever a new session is triggered
  const fetchOpening = useCallback(async () => {
    if (!userId || !onboardingComplete) return;
    setOpeningLoading(true);
    setOpeningMessage(null);
    try {
      const r = await fetch(`/api/conversation/opening?userId=${userId}`);
      const convId = r.headers.get('X-Conversation-Id');
      const marcusText = decodeURIComponent(r.headers.get('X-Marcus-Text') || '');
      if (convId) setConversationId(convId);
      if (marcusText) setOpeningMessage(marcusText);
      // Refresh sidebar to show the new session
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
    }
  }, [userId, onboardingComplete]);

  // Auto-start first session once onboarding completes, and on every sessionTrigger
  useEffect(() => {
    if (!userId || !onboardingComplete) return;
    fetchOpening();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, onboardingComplete, sessionTrigger]);

  const initUser = async () => {
    if (!email) return;
    try {
      const res = await fetch(`/api/conversation?email=${encodeURIComponent(email)}&name=`);
      const data = await res.json();
      setUserId(data.id);
      setInitialized(true);
    } catch (err) {
      console.error('Init error:', err);
    }
  };

  const handleTranscript = useCallback((userText: string, marcusText: string) => {
    setTranscripts((prev) => [...prev, { user: userText, marcus: marcusText }]);
    setRefreshSidebar((p) => p + 1);
  }, []);

  const handleNewSession = () => {
    setConversationId(null);
    setTranscripts([]);
    setOpeningMessage(null);
    setView('voice');
    setSelectedConvId(null);
    // Trigger a new opening message fetch
    setSessionTrigger((p) => p + 1);
  };

  const handleGoToAnalytics = () => {
    setView('analytics');
    setSelectedConvId(null);
  };

  const handleSelectSession = (id: string) => {
    setSelectedConvId(id);
    setView('session-detail');
    setSidebarOpen(false);
  };

  const statusLabel: Record<VoiceState, string> = {
    idle: 'Tap the orb to speak',
    listening: 'Listening…',
    processing: 'Reflecting…',
    speaking: 'Marcus is speaking…',
  };

  // ─── Login ───
  if (!initialized || !userId) {
    return (
      <div className="h-screen flex flex-col items-center justify-center px-6 relative">
        <div className="ambient-bg" />
        <div className="relative z-10 flex flex-col items-center fade-in-up max-w-md w-full">
          {/* Logo */}
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#a3785e]/15 to-[#a3785e]/5 border border-[#a3785e]/20 flex items-center justify-center mb-8">
            <span className="text-3xl font-light text-[#a3785e]">M</span>
          </div>

          <h1 className="text-4xl font-semibold tracking-tight mb-2 text-foreground">mrkos.ai</h1>
          <p className="text-sm text-muted-foreground mb-12 tracking-wide">Your Stoic Companion</p>

          <div className="w-full max-w-sm space-y-4">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && initUser()}
              placeholder="Enter your email"
              className="h-13 bg-white border-border text-foreground placeholder:text-muted-foreground/60 rounded-xl px-5 text-sm"
            />
            <Button
              onClick={initUser}
              className="w-full h-13 text-sm font-medium rounded-xl bg-[#44403c] hover:bg-[#57534e] text-white transition-all"
            >
              Begin Your Journey
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>

          <p className="text-[11px] mt-16 max-w-xs text-center leading-relaxed text-muted-foreground/50 italic">
            &quot;Waste no more time arguing about what a good man should be. Be one.&quot;
            <span className="block mt-1 not-italic text-muted-foreground/40">— Marcus Aurelius</span>
          </p>
        </div>
      </div>
    );
  }

  // ─── Loading ───
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
        <div className="relative z-10">
          <OnboardingFlow userId={userId} onComplete={() => setOnboardingComplete(true)} />
        </div>
      </div>
    );
  }

  // ─── Main App ───
  return (
    <div className="h-screen flex flex-col relative">
      <div className="ambient-bg" />

      {/* Header */}
      <header className="relative z-20 border-b border-border bg-white sticky top-0">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
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

          {/* Nav Tabs — ZAP-inspired pill */}
          <div className="flex items-center gap-1 bg-secondary rounded-xl p-1 border border-border">
            <button
              onClick={() => { setView('voice'); setSelectedConvId(null); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                view === 'voice'
                  ? 'bg-white text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Speak</span>
            </button>
            <button
              onClick={handleGoToAnalytics}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                view === 'analytics' || view === 'session-detail'
                  ? 'bg-white text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sessions</span>
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-xs"
            onClick={handleNewSession}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New</span>
          </Button>
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
            <AnalyticsDashboard userId={userId} onStartSession={handleNewSession} onSelectSession={handleSelectSession} />
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
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}