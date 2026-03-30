'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles, Loader2, Lightbulb } from 'lucide-react';
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
        setMeta(data.conversation || null);
        const md = data.conversation?.metadata;
        if (md && typeof md === 'object') {
          if ('takeaways' in md) setTakeaways(md.takeaways as string[]);
          if ('title' in md) setTitle(md.title as string);
        }
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline text-xs">Back</span>
        </Button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {title || 'Session'}
          </h3>
          {meta && (
            <p className="text-[11px] text-muted-foreground/60">
              {new Date(meta.started_at).toLocaleDateString('en-US', {
                weekday: 'long', month: 'long', day: 'numeric'
              })}
            </p>
          )}
        </div>
        {!takeaways.length && (
          <Button
            variant="outline"
            size="sm"
            onClick={generateSummary}
            disabled={generating}
            className="gap-2 text-xs"
          >
            {generating ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5 text-[#c2917c]" /> Takeaways</>
            )}
          </Button>
        )}
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-8 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Takeaways card */}
          {(takeaways.length > 0 || meta?.summary) && (
            <div className="glass-strong rounded-2xl p-5 mb-6 fade-in-scale">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-[#a3785e]" />
                <span className="text-xs font-semibold uppercase tracking-widest text-[#a3785e]">
                  Key Takeaways
                </span>
              </div>
              {meta?.summary && (
                <p className="text-sm leading-relaxed text-foreground/90 mb-3">{meta.summary}</p>
              )}
              {takeaways.length > 0 && (
                <ul className="space-y-2">
                  {takeaways.map((t, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-muted-foreground">
                      <span className="text-[#a3785e]/60 mt-0.5">→</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Messages as chat bubbles */}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'flex',
                msg.role === 'marcus' ? 'justify-start' : 'justify-end'
              )}
            >
              <div className={cn(
                'message-bubble',
                msg.role === 'marcus' ? 'marcus-message' : 'user-message'
              )}>
                <p className="text-sm leading-relaxed">{msg.content}</p>
                {msg.emotion_detected && (
                  <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-[#a3785e]/8 text-[#a3785e]/80">
                    {msg.emotion_detected}
                  </span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

