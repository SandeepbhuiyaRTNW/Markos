'use client';

import { useState, useEffect } from 'react';
import { MessageSquare, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Session {
  id: string;
  started_at: string;
  summary: string | null;
  first_message: string | null;
  message_count: number;
  session_number: number;
  metadata: Record<string, unknown>;
}

interface SidebarProps {
  userId: string;
  onSelectSession: (id: string) => void;
  activeSessionId: string | null;
  onNewSession: () => void;
  refreshTrigger?: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

export default function Sidebar({
  userId,
  onSelectSession,
  activeSessionId,
  onNewSession,
  refreshTrigger,
  isOpen = false,
}: SidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/conversations?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => setSessions(data.conversations || []))
      .catch(console.error);
  }, [userId, refreshTrigger]);

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

  const getTitle = (session: Session) => {
    if (session.metadata && typeof session.metadata === 'object' && 'title' in session.metadata) {
      return session.metadata.title as string;
    }
    if (session.first_message) {
      return session.first_message.length > 32
        ? session.first_message.slice(0, 32) + '…'
        : session.first_message;
    }
    return `Session ${session.session_number}`;
  };

  return (
    <aside
      className={cn(
        'fixed lg:relative top-0 left-0 h-full z-30 w-72 flex flex-col',
        'bg-white border-r border-border transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}
    >
      {/* Header */}
      <div className="px-4 py-4 border-b border-sidebar-border">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">Sessions</h2>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto py-2">
        {sessions.length === 0 ? (
          <div className="px-4 py-16 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-[#a3785e]/5 border border-[#a3785e]/10 flex items-center justify-center mx-auto">
              <Mic className="w-5 h-5 text-[#a3785e]/30" />
            </div>
            <p className="text-xs text-muted-foreground/60">No sessions yet</p>
            <p className="text-[11px] text-muted-foreground/30">Start speaking to begin</p>
          </div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              className={cn(
                'w-full text-left px-4 py-3 transition-all duration-200 border-l-2 border-transparent',
                'hover:bg-accent',
                activeSessionId === session.id
                  ? 'bg-accent border-l-[#a3785e]'
                  : ''
              )}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/80 text-muted-foreground/50 font-mono">
                  {session.session_number}
                </span>
                <span className="text-[13px] font-medium text-sidebar-foreground truncate flex-1">
                  {getTitle(session)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mt-1">
                <span>{formatDate(session.started_at)}</span>
                <span className="text-muted-foreground/20">·</span>
                <MessageSquare className="w-3 h-3" />
                <span>{session.message_count}</span>
              </div>
              {session.summary && (
                <p className="text-[11px] text-muted-foreground/40 mt-1.5 line-clamp-2 leading-relaxed">
                  {session.summary}
                </p>
              )}
            </button>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-sidebar-border">
        <p className="text-[10px] text-center text-muted-foreground/25 tracking-wider">
          mrkos.ai
        </p>
      </div>
    </aside>
  );
}

