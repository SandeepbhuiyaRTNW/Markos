import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/conversations?userId=X
 * Returns all conversations for a user with preview and summary
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const result = await query(
      `SELECT 
        c.id,
        c.started_at,
        c.ended_at,
        c.summary,
        c.mood_start,
        c.mood_end,
        c.session_number,
        c.metadata,
        (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_message,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
      FROM conversations c
      WHERE c.user_id = $1
      ORDER BY c.started_at DESC`,
      [userId]
    );

    return NextResponse.json({ conversations: result.rows });
  } catch (error) {
    console.error('Conversations list error:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}

