import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/analytics?userId=X
 * Returns session stats and topic summaries for the analytics dashboard.
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    // All conversations with metadata
    const convsResult = await query(
      `SELECT
        c.id,
        c.started_at,
        c.summary,
        c.session_number,
        c.metadata,
        (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_message,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
       FROM conversations c
       WHERE c.user_id = $1
       ORDER BY c.started_at DESC`,
      [userId]
    );

    const conversations = convsResult.rows;
    const totalSessions = conversations.length;
    const totalMessages = conversations.reduce((sum: number, c: { message_count: string }) => sum + parseInt(c.message_count || '0'), 0);

    // Extract topics from metadata or summaries
    const topicMap: Record<string, number> = {};
    for (const conv of conversations) {
      // Try metadata.topics array first
      const meta = conv.metadata as Record<string, unknown> | null;
      if (meta && Array.isArray(meta.topics)) {
        for (const t of meta.topics as string[]) {
          topicMap[t] = (topicMap[t] || 0) + 1;
        }
      } else if (meta && typeof meta.title === 'string') {
        // Use title as a topic fallback
        const title = meta.title as string;
        topicMap[title] = (topicMap[title] || 0) + 1;
      } else if (conv.first_message) {
        // Extract rough topic from first message (first 4 words)
        const words = (conv.first_message as string).split(' ').slice(0, 4).join(' ');
        topicMap[words] = (topicMap[words] || 0) + 1;
      }
    }

    // Sort topics by frequency
    const topics = Object.entries(topicMap)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));

    return NextResponse.json({
      totalSessions,
      totalMessages,
      topics,
      conversations,
    });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}

