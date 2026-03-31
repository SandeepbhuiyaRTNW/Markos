import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/analytics?userId=X
 * Returns session stats, topic summaries, weekly usage, and last session info.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    // All conversations with metadata + session notes
    const [convsResult, weeklyResult, lastNotesResult] = await Promise.all([
      query(
        `SELECT
          c.id,
          c.started_at,
          c.ended_at,
          c.summary,
          c.session_number,
          c.session_ended,
          c.takeaways,
          c.pondering_topics,
          c.metadata,
          (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_message,
          (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
         FROM conversations c
         WHERE c.user_id = $1
         ORDER BY c.started_at DESC`,
        [userId]
      ),
      // Weekly session counts for the last 8 weeks
      query(
        `SELECT
          date_trunc('week', started_at)::date as week_start,
          COUNT(*) as session_count
         FROM conversations
         WHERE user_id = $1 AND started_at >= NOW() - INTERVAL '8 weeks'
         GROUP BY date_trunc('week', started_at)
         ORDER BY week_start ASC`,
        [userId]
      ),
      // Last completed session notes
      query(
        `SELECT sn.title, sn.summary, sn.takeaways, sn.pondering_topics, sn.stoic_principle, sn.mood
         FROM session_notes sn
         JOIN conversations c ON c.id = sn.conversation_id
         WHERE sn.user_id = $1
         ORDER BY sn.created_at DESC LIMIT 1`,
        [userId]
      ),
    ]);

    const conversations = convsResult.rows;
    const totalSessions = conversations.length;
    const totalMessages = conversations.reduce((sum: number, c: { message_count: string }) => sum + parseInt(c.message_count || '0'), 0);

    // Extract topics from metadata
    const topicMap: Record<string, number> = {};
    for (const conv of conversations) {
      const meta = conv.metadata as Record<string, unknown> | null;
      if (meta && Array.isArray(meta.topics)) {
        for (const t of meta.topics as string[]) {
          topicMap[t] = (topicMap[t] || 0) + 1;
        }
      } else if (meta && typeof meta.title === 'string') {
        topicMap[meta.title as string] = (topicMap[meta.title as string] || 0) + 1;
      } else if (conv.first_message) {
        const words = (conv.first_message as string).split(' ').slice(0, 4).join(' ');
        topicMap[words] = (topicMap[words] || 0) + 1;
      }
    }

    const topics = Object.entries(topicMap)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));

    // Build weekly usage array (fill gaps with 0)
    const weeklyUsage = weeklyResult.rows.map((r: { week_start: string; session_count: string }) => ({
      week: r.week_start,
      sessions: parseInt(r.session_count),
    }));

    // Last session info for continuity
    const lastSessionNotes = lastNotesResult.rows.length > 0 ? lastNotesResult.rows[0] : null;

    return NextResponse.json({
      totalSessions,
      totalMessages,
      topics,
      conversations,
      weeklyUsage,
      lastSessionNotes,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}

