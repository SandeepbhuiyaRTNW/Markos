import { NextRequest, NextResponse } from 'next/server';
import { processMessage } from '@/lib/agent/marcus';
import { query } from '@/lib/db';

/**
 * POST /api/conversation/text
 * Text-based conversation endpoint — same Marcus pipeline, no audio.
 * Body: { userId, conversationId?, message }
 * Returns: { marcusText, emotion, conversationId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, message } = body;
    let conversationId = body.conversationId as string | null;

    if (!userId || !message) {
      return NextResponse.json(
        { error: 'Missing userId or message' },
        { status: 400 }
      );
    }

    // Ensure user exists
    const userResult = await query(`SELECT id FROM users WHERE id = $1`, [
      userId,
    ]);
    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Create conversation if needed
    if (!conversationId) {
      const countResult = await query(
        `SELECT COUNT(*) as cnt FROM conversations WHERE user_id = $1`,
        [userId]
      );
      const sessionNumber = parseInt(countResult.rows[0].cnt, 10) + 1;
      const convResult = await query(
        `INSERT INTO conversations (user_id, session_number) VALUES ($1, $2) RETURNING id`,
        [userId, sessionNumber]
      );
      conversationId = convResult.rows[0].id;
    }

    // Get conversation history
    const historyResult = await query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 60`,
      [conversationId]
    );
    const history = historyResult.rows.map(
      (r: { role: string; content: string }) => ({
        role: r.role === 'marcus' ? ('assistant' as const) : ('user' as const),
        content: r.content,
      })
    );

    // Process through Marcus agent (same as voice path)
    const { response: marcusText, emotion } = await processMessage(
      userId,
      conversationId!,
      message,
      history
    );

    return NextResponse.json({
      marcusText,
      emotion,
      conversationId,
    });
  } catch (error) {
    console.error('Text conversation error:', error);
    return NextResponse.json(
      { error: 'Text conversation failed', details: String(error) },
      { status: 500 }
    );
  }
}

