'use client';

import { useEffect, useState } from 'react';
import { Mic, MessageSquare, BarChart2, Flame, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Topic { label: string; count: number; }
interface SessionRow {
  id: string; started_at: string; summary: string | null;
  first_message: string | null; message_count: number;
  session_number: number; metadata: Record<string, unknown>;
}
interface AnalyticsData {
  totalSessions: number; totalMessages: number;
  topics: Topic[]; conversations: SessionRow[];
}
interface AnalyticsDashboardProps {
  userId: string; onStartSession: () => void; onSelectSession: (id: string) => void;
}

export default function AnalyticsDashboard({ userId, onStartSession, onSelectSession }: AnalyticsDashboardProps) {
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

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getTitle = (s: SessionRow) => {
    if (s.metadata?.title) return s.metadata.title as string;
    if (s.first_message) return s.first_message.length > 40 ? s.first_message.slice(0, 40) + '…' : s.first_message;
    return `Session ${s.session_number}`;
  };

  const mainTopics = data?.topics.slice(0, 3) ?? [];
  const floatingTopics = data?.topics.slice(3, 12) ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 py-8 space-y-8 fade-in-up">

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="stat-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#a3785e]/8 flex items-center justify-center">
                <BarChart2 className="w-5 h-5 text-[#a3785e]/60" />
              </div>
              <div>
                <p className="text-3xl font-semibold text-foreground tabular-nums">
                  {loading ? '—' : data?.totalSessions ?? 0}
                </p>
                <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Sessions</p>
              </div>
            </div>
            <div className="stat-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#a3785e]/8 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-[#a3785e]/60" />
              </div>
              <div>
                <p className="text-3xl font-semibold text-foreground tabular-nums">
                  {loading ? '—' : data?.totalMessages ?? 0}
                </p>
                <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Exchanges</p>
              </div>
            </div>
          </div>

          {/* Main topics */}
          {mainTopics.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2">
                <Flame className="w-3.5 h-3.5 text-[#a3785e]/50" /> Key Themes
              </p>
              <div className="space-y-2">
                {mainTopics.map((t, i) => (
                  <div key={i} className="glass-card px-4 py-3 flex items-center justify-between group">
                    <span className="text-sm text-foreground/90">{t.label}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#a3785e]/8 text-[#a3785e]/70 font-mono">
                      {t.count}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Floating tags */}
          {floatingTopics.length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40">Also Explored</p>
              <div className="flex flex-wrap gap-2">
                {floatingTopics.map((t, i) => (
                  <span key={i} className="px-3 py-1 rounded-full text-xs border border-border/50 text-muted-foreground/60 bg-secondary/30 hover:bg-secondary/60 transition-colors cursor-default">
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Session list */}
          {(data?.conversations ?? []).length > 0 && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/40">Past Sessions</p>
              <div className="space-y-1.5">
                {(data?.conversations ?? []).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectSession(s.id)}
                    className="w-full text-left glass-card px-4 py-3.5 group flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 text-muted-foreground/40 font-mono shrink-0">
                          {s.session_number}
                        </span>
                        <span className="text-[13px] font-medium text-foreground/90 truncate flex-1">{getTitle(s)}</span>
                        <span className="text-[11px] text-muted-foreground/40 shrink-0">{formatDate(s.started_at)}</span>
                      </div>
                      {s.summary && (
                        <p className="text-[11px] text-muted-foreground/40 line-clamp-1 leading-relaxed mt-0.5">{s.summary}</p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-[#a3785e]/60 transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && data?.totalSessions === 0 && (
            <div className="text-center py-16 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-[#a3785e]/5 border border-[#a3785e]/10 flex items-center justify-center mx-auto">
                <Mic className="w-7 h-7 text-[#a3785e]/30" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground/70">No sessions yet</p>
                <p className="text-xs text-muted-foreground/35 mt-1">Begin your first conversation with Marcus</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Start Session CTA */}
      <div className="p-5 border-t border-border bg-white">
        <button
          onClick={onStartSession}
          className="w-full h-13 rounded-xl flex items-center justify-center gap-3 text-sm font-medium bg-[#44403c] hover:bg-[#57534e] text-white transition-all"
        >
          <Mic className="w-4 h-4" />
          Start Session
        </button>
      </div>
    </div>
  );
}

