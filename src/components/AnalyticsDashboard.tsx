'use client';

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import ShaderBackground from '@/components/ShaderBackground';

interface Topic { label: string; count: number; }
interface WeeklyUsage { week: string; sessions: number; }
interface LastSessionNotes {
  title: string; summary: string; takeaways: string[];
  pondering_topics: string[]; stoic_principle: string; mood: string;
}
interface SessionRow {
  id: string; started_at: string; ended_at: string | null;
  summary: string | null; first_message: string | null;
  message_count: number; session_number: number;
  session_ended: boolean; metadata: Record<string, unknown>;
}
interface AnalyticsData {
  totalSessions: number; totalMessages: number;
  topics: Topic[]; conversations: SessionRow[];
  weeklyUsage: WeeklyUsage[]; lastSessionNotes: LastSessionNotes | null;
}
interface AnalyticsDashboardProps {
  userId: string;
  onSelectSession: (id: string) => void;
  onContinueSession?: (id: string) => void;
  /** Start a brand-new (fresh) session — "or say something new". */
  onStartFresh?: () => void;
}

// ── Editorial helpers ───────────────────────────────────────────────────────────────
// Text colours below are contrast-checked against the e4634c7 ShaderBackground field
// (darkest field = clay #f0e0d0, L 0.764): #14100e 14.7:1, #3d352e 9.3:1, #6b6259 4.6:1,
// terracotta text #8a4a14 5.3:1 — all pass (headings/body >=7, muted >=4.5).
const INK = '#14100e';        // hero heading            — 14.7:1
const INK_SOFT = '#3d352e';   // session titles / body   — 9.3:1
const MUTED = '#6b6259';      // eyebrows, dates, count   — 4.6:1
const TERRA = '#8a4a14';      // warm action (darkened from #b0611f, which fails at 3.6:1)

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
function numberWord(n: number): string {
  const s = n >= 0 && n <= 20 ? NUM[n] : String(n);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function relativeDate(dateStr: string): string {
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 31) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'last month';
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
function dayTimeEyebrow(dateStr: string): string {
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return '';
  const days = Math.floor((Date.now() - dt.getTime()) / 86400000);
  const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : dt.toLocaleDateString('en-US', { weekday: 'long' });
  return `${day} · ${time}`.toUpperCase();
}
function lowerFirst(s: string): string { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
function stripEnd(s: string): string { return s.replace(/[.!?\s]+$/, ''); }
function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n).trimEnd() + '…' : s; }

// Human title for a session: the LLM-generated metadata.title (about what it was actually
// about), else the first user utterance truncated, else the session number.
function sessionTitle(s: SessionRow): string {
  const t = s.metadata?.title;
  if (typeof t === 'string' && t.trim()) return t;
  if (s.first_message?.trim()) return truncate(s.first_message.trim(), 52);
  return `Session ${s.session_number}`;
}
// The large-type sentence naming the unfinished thread, from real data.
function threadSentence(data: AnalyticsData): string {
  const title = data.lastSessionNotes?.title
    || (typeof data.conversations[0]?.metadata?.title === 'string' ? (data.conversations[0].metadata.title as string) : null);
  if (title?.trim()) return `You left off with ${lowerFirst(stripEnd(title.trim()))}.`;
  const fm = data.conversations[0]?.first_message;
  if (fm?.trim()) return `You left off mid-thought — “${truncate(fm.trim(), 60)}”.`;
  return 'You left off mid-conversation.';
}

const EYEBROW: React.CSSProperties = { fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTED };

export default function AnalyticsDashboard({ userId, onSelectSession, onContinueSession, onStartFresh }: AnalyticsDashboardProps) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/analytics?userId=${userId}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId]);

  const convs = data?.conversations ?? [];
  const total = data?.totalSessions ?? 0;

  // ── Empty state — ONCE (the old design rendered "No sessions yet" twice) ──
  if (!loading && total === 0) {
    return (
      <div className="relative flex-1 overflow-hidden">
        <ShaderBackground contained state="idle" register={0} />
        <div className="relative z-10 h-full flex items-center justify-center px-6 text-center">
          <div style={{ maxWidth: 460 }}>
            <p style={EYEBROW}>Nothing here yet</p>
            <h1 className="font-serif" style={{ fontSize: 'clamp(28px,4.5vw,40px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.2, color: INK, marginTop: 16 }}>
              This is where your conversations will live.
            </h1>
            {onStartFresh && (
              <button onClick={onStartFresh} className="inline-flex items-center gap-2 transition-opacity hover:opacity-70" style={{ color: TERRA, fontSize: 19, marginTop: 24 }}>
                Start the first one <ArrowRight className="w-5 h-5" strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const sinceMonth = convs.length > 0
    ? new Date(convs[convs.length - 1].started_at).toLocaleDateString('en-US', { month: 'long' })
    : '';

  return (
    <div className="relative flex-1 overflow-hidden">
      <ShaderBackground contained state="idle" register={0} />
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto w-full px-6 sm:px-10 lg:px-16 py-16 fade-in-up" style={{ maxWidth: 720 }}>
          {loading || !data ? (
            <p style={{ ...EYEBROW, opacity: 0.6 }}>Loading…</p>
          ) : (
            <>
              {/* Eyebrow — when you left off */}
              <p style={EYEBROW}>{dayTimeEyebrow(convs[0].ended_at || convs[0].started_at)}</p>

              {/* Hero — the unfinished thread */}
              <h1 className="font-serif" style={{ fontSize: 'clamp(30px,5vw,46px)', fontWeight: 400, letterSpacing: '-0.02em', lineHeight: 1.16, color: INK, maxWidth: 520, marginTop: 14 }}>
                {threadSentence(data)}
              </h1>

              {/* Warm action + quieter alternative */}
              <div style={{ marginTop: 22 }}>
                <button
                  onClick={() => onContinueSession?.(convs[0].id)}
                  className="inline-flex items-center gap-2 transition-opacity hover:opacity-70"
                  style={{ color: TERRA, fontSize: 19, lineHeight: 1.3 }}
                >
                  Pick that back up <ArrowRight className="w-5 h-5" strokeWidth={1.75} />
                </button>
                {onStartFresh && (
                  <div style={{ marginTop: 8 }}>
                    <button onClick={onStartFresh} className="transition-opacity hover:opacity-70" style={{ color: MUTED, fontSize: 15 }}>
                      or say something new
                    </button>
                  </div>
                )}
              </div>

              {/* BEFORE — past sessions as plain lines (no rows, borders, icons, counts, tags) */}
              {convs.length > 1 && (
                <div style={{ marginTop: 56 }}>
                  <p style={EYEBROW}>Before</p>
                  <div style={{ marginTop: 20 }}>
                    {convs.slice(1).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => onSelectSession(s.id)}
                        className="block w-full text-left transition-opacity hover:opacity-70"
                        style={{ marginTop: 22 }}
                      >
                        <div style={{ fontSize: 20, color: INK_SOFT, lineHeight: 1.3 }}>{sessionTitle(s)}</div>
                        <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>{relativeDate(s.ended_at || s.started_at)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* One quiet line */}
              {total > 0 && sinceMonth && (
                <p style={{ marginTop: 52, fontSize: 13, color: MUTED }}>
                  {numberWord(total)} {total === 1 ? 'conversation' : 'conversations'} since {sinceMonth}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
