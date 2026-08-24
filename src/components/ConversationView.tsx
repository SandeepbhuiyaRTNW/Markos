'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import SessionSummary from '@/components/SessionSummary';

interface Message { role: string; content: string; created_at: string; }
interface ConversationMeta {
  id: string; started_at: string; summary: string | null; session_ended: boolean;
  takeaways: string[] | null; pondering_topics: string[] | null; metadata: Record<string, unknown>;
}
interface ConversationViewProps { conversationId: string; onBack: () => void; }

const MUTED = '#6b6259';
const INK_SOFT = '#3d352e';
const TERRA = '#8a4a14';
const EYEBROW: CSSProperties = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTED };

export default function ConversationView({ conversationId, onBack }: ConversationViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<ConversationMeta | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [takeaways, setTakeaways] = useState<string[]>([]);
  const [ponderingTopics, setPonderingTopics] = useState<string[]>([]);
  const [stoicPrinciple, setStoicPrinciple] = useState<string>('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data.messages || []);
        const conv = data.conversation || null;
        setMeta(conv);
        const md = conv?.metadata as Record<string, unknown> | null;
        setTitle((md?.title as string) || '');
        setSummary(conv?.summary ?? null);
        setTakeaways(conv?.takeaways || (md?.takeaways as string[]) || []);
        setPonderingTopics(conv?.pondering_topics || (md?.pondering_topics as string[]) || []);
        setStoicPrinciple((md?.stoic_principle as string) || '');
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
      if (data.stoic_principle) setStoicPrinciple(data.stoic_principle);
      if (data.title) setTitle(data.title);
      if (data.summary) setSummary(data.summary);
    } catch (err) { console.error(err); }
    setGenerating(false);
  };

  const dateLabel = meta
    ? new Date(meta.started_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()
    : '';

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 py-14" style={{ maxWidth: 720 }}>
          <button onClick={onBack} className="inline-flex items-center gap-1.5 transition-opacity hover:opacity-70" style={{ color: MUTED, fontSize: 13 }}>
            <ArrowLeft className="w-4 h-4" strokeWidth={1.75} /> Back
          </button>

          {loading ? (
            <p style={{ ...EYEBROW, marginTop: 40 }}>Loading…</p>
          ) : (
            <div style={{ marginTop: 28 }}>
              <SessionSummary
                title={title || 'Session'}
                dateLabel={dateLabel}
                summary={summary}
                takeaways={takeaways}
                ponderingTopics={ponderingTopics}
                stoicPrinciple={stoicPrinciple}
              />

              {!takeaways.length && !summary && (
                <button onClick={generateSummary} disabled={generating} className="inline-flex items-center gap-2 transition-opacity hover:opacity-70 disabled:opacity-50" style={{ color: TERRA, fontSize: 16, marginTop: 24 }}>
                  {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : 'Generate summary'}
                </button>
              )}

              {/* The conversation — plain, no bubbles, no emotion pills */}
              {messages.length > 0 && (
                <div style={{ marginTop: 56 }}>
                  <p style={EYEBROW}>The conversation</p>
                  <div style={{ marginTop: 20 }}>
                    {messages.map((m, i) => (
                      <div key={i} style={{ marginTop: i === 0 ? 0 : 24, maxWidth: 620 }}>
                        <p style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: MUTED, marginBottom: 4 }}>{m.role === 'marcus' ? 'Marcus' : 'You'}</p>
                        <p style={{ fontSize: 17, lineHeight: 1.6, color: INK_SOFT }}>{m.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
