'use client';

import { useEffect, useState } from 'react';
import { Mic, MessageSquare, BarChart2, Flame, ChevronRight, Lightbulb, BookOpen, PlayCircle } from 'lucide-react';

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
}

export default function AnalyticsDashboard({ userId, onSelectSession, onContinueSession }: AnalyticsDashboardProps) {
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

  const formatDate = (session: { started_at: string; ended_at?: string | null; session_ended?: boolean }) => {
    const dateStr = (session.session_ended && session.ended_at) ? session.ended_at : session.started_at;
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getTitle = (s: SessionRow) => {
    if (s.metadata?.title) return s.metadata.title as string;
    if (s.first_message) return s.first_message.length > 40 ? s.first_message.slice(0, 40) + '…' : s.first_message;
    return `Session ${s.session_number}`;
  };

  const maxWeekly = Math.max(...(data?.weeklyUsage?.map(w => w.sessions) ?? [1]), 1);
  const allTopics = data?.topics ?? [];

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
      {/* ─── LEFT PANEL: Analytics ─── */}
      <div className="lg:w-[40%] lg:border-r border-border lg:overflow-y-auto lg:h-[calc(100vh-60px)] overflow-y-auto">
        <div className="px-5 py-8 space-y-6 fade-in-up">

          {/* Last session pondering */}
          {data?.lastSessionNotes && (
            <div className="glass-strong rounded-2xl p-5 fade-in-scale">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-[#a3785e]" />
                <span className="text-xs font-semibold uppercase tracking-widest text-[#a3785e]">From Your Last Session</span>
              </div>
              <p className="text-sm leading-relaxed text-foreground/80 mb-3">{data.lastSessionNotes.summary}</p>
              {data.lastSessionNotes.pondering_topics?.length > 0 && (
                <div className="space-y-2 mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">Things to ponder</p>
                  {data.lastSessionNotes.pondering_topics.map((t, i) => (
                    <div key={i} className="flex gap-2.5 text-sm text-muted-foreground"><span className="text-[#a3785e]/60 mt-0.5">→</span><span className="italic">{t}</span></div>
                  ))}
                </div>
              )}
              {data.lastSessionNotes.stoic_principle && (
                <div className="mt-3 pt-3 border-t border-border/30">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-3.5 h-3.5 text-[#a3785e]/50" />
                    <span className="text-[11px] text-muted-foreground/50">Stoic Principle: <span className="text-foreground/70">{data.lastSessionNotes.stoic_principle}</span></span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="stat-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#a3785e]/8 flex items-center justify-center"><BarChart2 className="w-5 h-5 text-[#a3785e]/60" /></div>
              <div><p className="text-3xl font-semibold text-foreground tabular-nums">{loading ? '—' : data?.totalSessions ?? 0}</p><p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Sessions</p></div>
            </div>
            <div className="stat-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#a3785e]/8 flex items-center justify-center"><MessageSquare className="w-5 h-5 text-[#a3785e]/60" /></div>
              <div><p className="text-3xl font-semibold text-foreground tabular-nums">{loading ? '—' : data?.totalMessages ?? 0}</p><p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Exchanges</p></div>
            </div>
          </div>

          {/* Weekly Usage */}
          {(data?.weeklyUsage?.length ?? 0) > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2"><BarChart2 className="w-3.5 h-3.5 text-[#a3785e]/50" /> Weekly Activity</p>
              <div className="glass-card px-4 py-4">
                <div className="flex items-end gap-2 h-20">
                  {(data?.weeklyUsage ?? []).map((w, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] text-muted-foreground/50 font-mono">{w.sessions}</span>
                      <div className="w-full rounded-t-md bg-gradient-to-t from-[#a3785e]/40 to-[#a3785e]/20 transition-all" style={{ height: `${Math.max((w.sessions / maxWeekly) * 56, 4)}px` }} />
                      <span className="text-[9px] text-muted-foreground/30">{new Date(w.week).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Topics */}
          {allTopics.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2"><Flame className="w-3.5 h-3.5 text-[#a3785e]/50" /> Conversation Themes</p>
              <div className="glass-card px-4 py-4 space-y-3">
                {allTopics.slice(0, 6).map((t, i) => {
                  const maxCount = allTopics[0]?.count ?? 1;
                  const pct = Math.max((t.count / maxCount) * 100, 8);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between"><span className="text-xs text-foreground/80">{t.label}</span><span className="text-[10px] text-muted-foreground/50 font-mono">{t.count}×</span></div>
                      <div className="h-1.5 bg-secondary/50 rounded-full overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-[#a3785e]/60 to-[#a3785e]/30 transition-all" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              {allTopics.length > 6 && (
                <div className="flex flex-wrap gap-2">
                  {allTopics.slice(6, 15).map((t, i) => (
                    <span key={i} className="px-3 py-1 rounded-full text-xs border border-border/50 text-muted-foreground/60 bg-secondary/30">{t.label}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state (mobile-only since right panel also shows it) */}
          {!loading && data?.totalSessions === 0 && (
            <div className="text-center py-16 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-[#a3785e]/5 border border-[#a3785e]/10 flex items-center justify-center mx-auto"><Mic className="w-7 h-7 text-[#a3785e]/30" /></div>
              <div><p className="text-sm text-muted-foreground/70">No sessions yet</p><p className="text-xs text-muted-foreground/35 mt-1">Click &quot;New Session&quot; to begin</p></div>
            </div>
          )}
        </div>
      </div>

      {/* ─── RIGHT PANEL: Session List ─── */}
      <div className="lg:w-[60%] lg:overflow-y-auto lg:h-[calc(100vh-60px)] overflow-y-auto">
        <div className="px-5 py-8 space-y-3 fade-in-up">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-4">Past Sessions</p>
          {(data?.conversations ?? []).length > 0 ? (
            <div className="space-y-2">
              {(data?.conversations ?? []).map((s) => (
                <div key={s.id} className="glass-card px-5 py-4 group hover:border-[#a3785e]/20 transition-all">
                  <button onClick={() => onSelectSession(s.id)} className="w-full text-left flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground/40 font-mono shrink-0">{s.session_number}</span>
                        <span className="text-[13px] font-medium text-foreground/90 truncate flex-1">{getTitle(s)}</span>
                        <span className="text-[11px] text-muted-foreground/40 shrink-0">{formatDate(s)}</span>
                      </div>
                      {s.summary && <p className="text-[11px] text-muted-foreground/40 line-clamp-2 leading-relaxed mt-0.5">{s.summary}</p>}
                      {typeof s.metadata?.mood === 'string' && <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full bg-[#a3785e]/8 text-[#a3785e]/60">{s.metadata.mood}</span>}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-[#a3785e]/60 transition-colors shrink-0" />
                  </button>
                  {/* Continue conversation button — available for ALL sessions */}
                  {onContinueSession && (
                    <div className="mt-3 pt-3 border-t border-border/30">
                      <button
                        onClick={(e) => { e.stopPropagation(); onContinueSession(s.id); }}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#a3785e]/8 hover:bg-[#a3785e]/15 text-[#a3785e] text-xs font-medium transition-all"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        Continue this conversation
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : !loading ? (
            <div className="text-center py-20 space-y-3">
              <p className="text-sm text-muted-foreground/50">No sessions yet</p>
              <p className="text-xs text-muted-foreground/30">Your conversations with Marcus will appear here</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
