import { NextRequest, NextResponse } from 'next/server';
import { processMessage } from '@/lib/agent/marcus';
import { synthesizeSpeech } from '@/lib/voice/tts';
import { query } from '@/lib/db';

/**
 * Text-based test endpoint for the full Marcus pipeline.
 * POST /api/test-conversation
 * Body: { userId, message, conversationId?, skipTts? }
 * Returns: { userText, marcusText, emotion, conversationId, agentTimings, errors, ... }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, message, conversationId: convIdInput, skipTts } = await req.json();

    if (!userId || !message) {
      return NextResponse.json({ error: 'Missing userId or message' }, { status: 400 });
    }

    // Ensure user exists
    const userResult = await query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let conversationId = convIdInput;
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
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 20`,
      [conversationId]
    );
    const history = historyResult.rows.map((r: { role: string; content: string }) => ({
      role: r.role === 'marcus' ? 'assistant' as const : 'user' as const,
      content: r.content,
    }));

    // Process through full Marcus multi-agent pipeline
    const startTime = Date.now();
    const {
      response: marcusText,
      emotion,
      kwmlArchetype,
      agentTimings,
      errors,
    } = await processMessage(userId, conversationId, message, history);
    const agentTime = Date.now() - startTime;

    // TTS is optional for speed testing
    let ttsTime = 0;
    let audioSize = 0;
    if (!skipTts) {
      const ttsStart = Date.now();
      const audioBuffer = await synthesizeSpeech(marcusText);
      ttsTime = Date.now() - ttsStart;
      audioSize = audioBuffer.byteLength;
    }

    return NextResponse.json({
      userText: message,
      marcusText,
      emotion,
      kwmlArchetype,
      conversationId,
      audioSize,
      agentTimings,
      errors,
      timings: {
        agentPipelineMs: agentTime,
        ttsMs: ttsTime,
        totalMs: agentTime + ttsTime,
        breakdown: agentTimings,
      },
    });
  } catch (error) {
    console.error('Test conversation error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}

