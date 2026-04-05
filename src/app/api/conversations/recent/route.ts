import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/conversations/recent?userId=xxx
 * Returns recent ended sessions that can be continued from.
 * Groups by thread — if a session was continued, shows the latest in that thread.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 });
  }

  // Get recent ended sessions with at least 1 user message
  const result = await query(
    `SELECT
      c.id,
      c.session_number,
      c.started_at,
      c.ended_at,
      c.summary,
      c.pondering_topics,
      c.metadata,
      c.parent_session_id,
      (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_user_message
     FROM conversations c
     WHERE c.user_id = $1
       AND c.session_ended = true
       AND EXISTS (SELECT 1 FROM messages WHERE conversation_id = c.id AND role = 'user')
     ORDER BY c.ended_at DESC
     LIMIT 10`,
    [userId]
  );

  // Build thread-aware list: show the latest session in each thread
  // A "thread" is a chain of parent_session_id references
  interface SessionRow {
    id: string; session_number: number; started_at: string; ended_at: string;
    summary: string | null; pondering_topics: string[] | null;
    metadata: Record<string, unknown> | null; parent_session_id: string | null;
    first_user_message: string | null;
  }

  const sessions = result.rows as SessionRow[];

  // Find thread heads (sessions that aren't continued by any other session in the list)
  const continuedFromIds = new Set(sessions.map(s => s.parent_session_id).filter(Boolean));
  const threadHeads = sessions.filter(s => !continuedFromIds.has(s.id));

  // Format for the UI
  const formatted = threadHeads.slice(0, 5).map(s => ({
    id: s.id,
    sessionNumber: s.session_number,
    title: s.summary
      ? s.summary.substring(0, 80) + (s.summary.length > 80 ? '…' : '')
      : s.first_user_message
        ? s.first_user_message.substring(0, 80) + (s.first_user_message.length > 80 ? '…' : '')
        : `Session ${s.session_number}`,
    date: s.ended_at || s.started_at,
    hasPondering: !!(s.pondering_topics && s.pondering_topics.length > 0),
    sessionType: s.metadata && (s.metadata as Record<string, unknown>).sessionType === 'fresh' ? 'fresh' : 'continue',
  }));

  return NextResponse.json({ sessions: formatted });
}

