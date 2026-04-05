'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles, Loader2, Lightbulb, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Message {
  role: string;
  content: string;
  created_at: string;
  emotion_detected: string | null;
}

interface ConversationMeta {
  id: string;
  started_at: string;
  summary: string | null;
  session_ended: boolean;
  takeaways: string[] | null;
  pondering_topics: string[] | null;
  metadata: Record<string, unknown>;
}

interface ConversationViewProps {
  conversationId: string;
  onBack: () => void;
}

export default function ConversationView({ conversationId, onBack }: ConversationViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [takeaways, setTakeaways] = useState<string[]>([]);
  const [ponderingTopics, setPonderingTopics] = useState<string[]>([]);
  const [pattern, setPattern] = useState<string>('');
  const [actionPlan, setActionPlan] = useState<string[]>([]);
  const [checkIn, setCheckIn] = useState<string>('');
  const [stoicPrinciple, setStoicPrinciple] = useState<string>('');
  const [mood, setMood] = useState<string>('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || []);
        const conv = data.conversation || null;
        setMeta(conv);
        // Read from new columns first, fall back to metadata
        const md = conv?.metadata as Record<string, unknown> | null;
        setTitle((md?.title as string) || '');
        setTakeaways(conv?.takeaways || (md?.takeaways as string[]) || []);
        setPonderingTopics(conv?.pondering_topics || (md?.pondering_topics as string[]) || []);
        setPattern((md?.pattern as string) || '');
        setActionPlan((md?.action_plan as string[]) || []);
        setCheckIn((md?.check_in as string) || '');
        setStoicPrinciple((md?.stoic_principle as string) || '');
        setMood((md?.mood as string) || '');
        setLoading(false);
      })
      .catch((err) => { console.error(err); setLoading(false); });
  }, [conversationId]);

  const generateSummary = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, { method: 'POST' });
      const data = await res.json();
      if (data.takeaways) setTakeaways(data.takeaways);
      if (data.pondering_topics) setPonderingTopics(data.pondering_topics);
      if (data.pattern) setPattern(data.pattern);
      if (data.action_plan) setActionPlan(data.action_plan);
      if (data.check_in) setCheckIn(data.check_in);
      if (data.stoic_principle) setStoicPrinciple(data.stoic_principle);
      if (data.mood) setMood(data.mood);
      if (data.title) setTitle(data.title);
      if (data.summary && meta) setMeta({ ...meta, summary: data.summary });
    } catch (err) { console.error(err); }
    setGenerating(false);
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 rounded-full border-2 border-[#a3785e]/20 border-t-[#a3785e] animate-spin" />
        <p className="text-xs text-muted-foreground/50">Loading session…</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full fade-in">
      {/* Header */}
      <div className="px-4 lg:px-6 py-3 border-b border-border bg-white flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground hover:text-foreground gap-1.5">
          <ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline text-xs">Back</span>
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{title || 'Session'}</h3>
          {meta && <p className="text-[11px] text-muted-foreground/60">{new Date(meta.started_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>}
        </div>
        {mood && <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-[#a3785e]/8 text-[#a3785e]/70 font-medium uppercase tracking-wider">{mood}</span>}
      </div>

      {/* Split-screen body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* ─── LEFT PANEL: Session Notes ─── */}
        <div className="lg:w-[40%] lg:border-r border-border lg:overflow-y-auto lg:h-full overflow-y-auto shrink-0">
          <div className="px-5 py-6 space-y-4">
            {/* Summary */}
            {meta?.summary && (
              <div className="glass-strong rounded-2xl p-5">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#a3785e] block mb-2">Summary</span>
                <p className="text-sm leading-relaxed text-foreground/90">{meta.summary}</p>
              </div>
            )}

            {/* Key Takeaways */}
            {takeaways.length > 0 && (
              <div className="glass-strong rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-4 h-4 text-[#a3785e]" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-[#a3785e]">Key Takeaways</span>
                </div>
                <ul className="space-y-2">
                  {takeaways.map((t, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-foreground/80"><span className="text-[#a3785e]/60 mt-0.5">→</span><span>{t}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pondering Topics */}
            {ponderingTopics.length > 0 && (
              <div className="glass-strong rounded-2xl p-5 border border-[#a3785e]/10">
                <span className="text-xs font-semibold uppercase tracking-widest text-[#a3785e] block mb-3">Ponder Before Next Session</span>
                <div className="space-y-3">
                  {ponderingTopics.map((t, i) => (
                    <div key={i} className="flex gap-2.5 text-sm text-muted-foreground italic"><span className="text-[#a3785e]/50 mt-0.5 not-italic">✦</span><span>{t}</span></div>
                  ))}
                </div>
              </div>
            )}

            {/* Pattern */}
            {pattern && (
              <div className="glass-strong rounded-2xl p-5 border border-orange-500/10 bg-orange-50/30 dark:bg-orange-950/10">
                <span className="text-xs font-semibold uppercase tracking-widest text-orange-600/80 block mb-2">🔁 The Pattern</span>
                <p className="text-sm leading-relaxed text-foreground/80">{pattern}</p>
              </div>
            )}

            {/* Action Plan */}
            {actionPlan.length > 0 && (
              <div className="glass-strong rounded-2xl p-5 border border-emerald-500/10 bg-emerald-50/30 dark:bg-emerald-950/10">
                <span className="text-xs font-semibold uppercase tracking-widest text-emerald-600/80 block mb-3">🎯 Action Plan</span>
                <ul className="space-y-2">
                  {actionPlan.map((a, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-foreground/80">
                      <span className="text-emerald-600/60 mt-0.5 font-medium">{i + 1}.</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Check-in */}
            {checkIn && (
              <div className="glass-strong rounded-2xl p-5 border border-blue-500/10 bg-blue-50/30 dark:bg-blue-950/10">
                <span className="text-xs font-semibold uppercase tracking-widest text-blue-600/80 block mb-2">📊 Check In (3-5 Days)</span>
                <p className="text-sm leading-relaxed text-foreground/80 italic">{checkIn}</p>
              </div>
            )}

            {/* Stoic Principle */}
            {stoicPrinciple && (
              <div className="flex items-center gap-2 py-2">
                <BookOpen className="w-3.5 h-3.5 text-[#a3785e]/50" />
                <span className="text-[11px] text-muted-foreground/50">Stoic Principle: <span className="text-foreground/70 font-medium">{stoicPrinciple}</span></span>
              </div>
            )}

            {/* Generate button if no takeaways */}
            {!takeaways.length && !meta?.summary && (
              <Button variant="outline" size="sm" onClick={generateSummary} disabled={generating} className="w-full gap-2 text-xs">
                {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><Sparkles className="w-3.5 h-3.5 text-[#c2917c]" /> Generate Takeaways</>}
              </Button>
            )}
          </div>
        </div>

        {/* ─── RIGHT PANEL: Conversation Transcript ─── */}
        <div className="lg:w-[60%] flex-1 overflow-y-auto lg:h-full">
          <div className="px-5 py-6 space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-2">Conversation</p>
            {messages.map((msg, i) => (
              <div key={i} className={cn('flex', msg.role === 'marcus' ? 'justify-start' : 'justify-end')}>
                <div className={cn('message-bubble', msg.role === 'marcus' ? 'marcus-message' : 'user-message')}>
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                  {msg.emotion_detected && (
                    <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-[#a3785e]/8 text-[#a3785e]/80">{msg.emotion_detected}</span>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

