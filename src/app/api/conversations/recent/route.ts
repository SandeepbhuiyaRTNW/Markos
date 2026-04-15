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

  // Get ALL ended sessions with at least 1 user message — show every conversation
  // the user has had so they can continue from ANY of them
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
     LIMIT 20`,
    [userId]
  );

  interface SessionRow {
    id: string; session_number: number; started_at: string; ended_at: string;
    summary: string | null; pondering_topics: string[] | null;
    metadata: Record<string, unknown> | null; parent_session_id: string | null;
    first_user_message: string | null;
  }

  const sessions = result.rows as SessionRow[];

  // Show ALL sessions — no thread deduplication. The user should be able to
  // continue from ANY past conversation, not just the latest in a chain.
  const formatted = sessions.map(s => {
    const md = (s.metadata || {}) as Record<string, unknown>;
    const metaTitle = md.title as string | undefined;

    // Title: use metadata.title (short), fallback to first user message
    const title = metaTitle
      || (s.first_user_message
        ? s.first_user_message.substring(0, 50) + (s.first_user_message.length > 50 ? '…' : '')
        : `Session ${s.session_number}`);

    // Summary: 1-line preview of what was discussed
    const summary = s.summary
      ? s.summary.substring(0, 120) + (s.summary.length > 120 ? '…' : '')
      : null;

    // Pondering preview: first pondering topic (what they'd continue into)
    const ponderingPreview = s.pondering_topics && s.pondering_topics.length > 0
      ? s.pondering_topics[0].substring(0, 100) + (s.pondering_topics[0].length > 100 ? '…' : '')
      : null;

    // Full takeaways for the dropdown
    const takeaways = (md.takeaways as string[]) || s.pondering_topics || [];
    const ponderingTopics = s.pondering_topics || [];

    return {
      id: s.id,
      sessionNumber: s.session_number,
      title,
      summary: s.summary || null, // full summary, not truncated
      ponderingPreview,
      ponderingTopics, // full list for dropdown
      takeaways,       // full list for dropdown
      date: s.ended_at || s.started_at,
      sessionType: md.sessionType === 'fresh' ? 'fresh' : 'continue',
    };
  });

  return NextResponse.json({ sessions: formatted });
}

