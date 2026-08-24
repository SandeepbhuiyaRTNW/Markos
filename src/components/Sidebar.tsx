'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { getSessionTitle, formatSessionDate } from '@/lib/sessionMeta';

interface Session {
  id: string; started_at: string; ended_at: string | null; session_ended: boolean;
  summary: string | null; first_message: string | null; message_count: number;
  session_number: number; metadata: Record<string, unknown>;
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

const INK = '#14100e';
const INK_SOFT = '#3d352e';
const MUTED = '#6b6259';

// Session rail, on the system: no card boxes, no borders, no icons/counts — titles in sans,
// dates in muted grey, active in ink. Titles/dates come from the shared helpers (DO #7).
export default function Sidebar({ userId, onSelectSession, activeSessionId, refreshTrigger, isOpen = false }: SidebarProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/conversations?userId=${userId}`)
      .then((r) => r.json())
      .then((data) => setSessions(data.conversations || []))
      .catch(console.error);
  }, [userId, refreshTrigger]);

  return (
    <aside
      className={cn(
        'fixed lg:relative top-0 left-0 h-full z-30 w-64 flex flex-col transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}
      style={{ background: 'rgba(250,249,246,0.55)', backdropFilter: 'blur(3px)' }}
    >
      <div className="px-6 pt-6 pb-2">
        <p style={{ fontSize: 13, letterSpacing: '0.22em', textTransform: 'uppercase', color: MUTED }}>Sessions</p>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-8">
        {sessions.length === 0 ? (
          <p style={{ fontSize: 14, color: MUTED, marginTop: 10 }}>No sessions yet</p>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className="block w-full text-left transition-opacity hover:opacity-70"
              style={{ marginTop: 18 }}
            >
              <div style={{ fontSize: 16, lineHeight: 1.3, color: activeSessionId === s.id ? INK : INK_SOFT, fontWeight: activeSessionId === s.id ? 500 : 400 }}>
                {getSessionTitle(s)}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{formatSessionDate(s)}</div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
