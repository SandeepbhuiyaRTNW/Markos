import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/voice/stt';
import { synthesizeSpeech } from '@/lib/voice/tts';
import { processMessage } from '@/lib/agent/marcus';
import { query } from '@/lib/db';

// POST: Send audio, get audio back
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const userId = formData.get('userId') as string;
    let conversationId = formData.get('conversationId') as string | null;

    if (!audioFile || !userId) {
      return NextResponse.json({ error: 'Missing audio or userId' }, { status: 400 });
    }

    // Ensure user exists
    const userResult = await query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Use the provided conversationId or create a NEW one for this session
    if (!conversationId) {
      // Count existing conversations to set session_number
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

    // 1. Transcribe audio (Whisper)
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const userText = await transcribeAudio(audioBuffer, audioFile.type);

    // 2. Get full conversation history (last 60 messages to keep context rich)
    const historyResult = await query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC
       LIMIT 60`,
      [conversationId]
    );
    const history = historyResult.rows.map((r: { role: string; content: string }) => ({
      role: r.role === 'marcus' ? 'assistant' as const : 'user' as const,
      content: r.content,
    }));

    // 3. Process through Marcus agent
    const { response: marcusText, emotion } = await processMessage(
      userId,
      conversationId!,
      userText,
      history
    );

    // 4. Synthesize speech (ElevenLabs)
    const audioResponse = await synthesizeSpeech(marcusText);

    // Return both text and audio
    return new NextResponse(new Uint8Array(audioResponse), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'X-User-Text': encodeURIComponent(userText),
        'X-Marcus-Text': encodeURIComponent(marcusText),
        'X-Emotion': emotion,
        'X-Conversation-Id': conversationId!,
      },
    });
  } catch (error) {
    console.error('Conversation error:', error);
    return NextResponse.json(
      { error: 'Conversation processing failed', details: String(error) },
      { status: 500 }
    );
  }
}

// GET: Create a new user (for demo/dev)
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get('email');
  const name = req.nextUrl.searchParams.get('name');

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const result = await query(
    `INSERT INTO users (email, name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET name = COALESCE($2, users.name)
     RETURNING id, email, name`,
    [email, name]
  );

  return NextResponse.json(result.rows[0]);
}

