import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/voice/stt';
import { synthesizeSpeechStream } from '@/lib/voice/tts';
import { processMessage } from '@/lib/agent/marcus';
import { recordRouteTotal } from '@/lib/observability/turn-logger';
import { emitTurnTiming, emitAgentTimings, timeStage, instrumentAudioStream, type TurnTimingCtx } from '@/lib/observability/turn-timing';
import { query } from '@/lib/db';

// Cap this route's serverless execution at 60s (STT -> agent -> TTS is one long
// synchronous chain). NOTE: this ceiling is only effective if the Amplify SSR
// compute (Lambda) timeout AND the CloudFront origin-response timeout are raised
// to match (>= 60s) in the AWS console — otherwise the edge kills the request
// first. See "ACTION FOR SANDEEP" in the PR.
export const maxDuration = 60;

// POST: Send audio, get audio back
export async function POST(req: NextRequest) {
  // Route-level wall-clock start: entry -> response-ready (includes STT + TTS).
  const routeStart = Date.now();
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

    // 1. Transcribe audio (Whisper) — timed
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const sttStart = Date.now();
    const userText = await transcribeAudio(audioBuffer, audioFile.type);
    const sttMs = Date.now() - sttStart;

    // 2. Get conversation history — most recent 60 messages, re-ordered chronologically
    const historyResult = await query(
      `SELECT role, content FROM (
         SELECT role, content, created_at FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 60
       ) recent
       ORDER BY created_at ASC`,
      [conversationId]
    );
    const history = historyResult.rows.map((r: { role: string; content: string }) => ({
      role: r.role === 'marcus' ? 'assistant' as const : 'user' as const,
      content: r.content,
    }));

    const timingCtx: TurnTimingCtx = { path: 'voice', turn: history.length <= 1 ? 'first' : 'subsequent', conversationId: conversationId! };
    emitTurnTiming('stt', sttMs, timingCtx);

    // 3. Process through Marcus agent — timed (agent = full pipeline wall-clock;
    //    per-stage breakdown emitted from the returned agentTimings)
    const { response: marcusText, emotion, turnId, agentTimings } = await timeStage('agent', timingCtx, () => processMessage(
      userId,
      conversationId!,
      userText,
      history,
    ));
    emitAgentTimings(agentTimings, timingCtx);

    // 4. Synthesize speech (ElevenLabs) — STREAMING. Returns as soon as ElevenLabs
    //    starts producing audio; the body is piped to the client as it arrives, so the
    //    user hears the first words without waiting for the whole clip. The reply text
    //    is already fully written + gate-checked above — only delivery changes here.
    const ttsStart = Date.now();
    const ttsStream = await synthesizeSpeechStream(marcusText);
    // Tap the stream for time-to-first-audio / full-synthesis timing + mid-stream break
    // handling on the way to the client.
    const audioStream = instrumentAudioStream(ttsStream, timingCtx, ttsStart);

    // route_total now measures entry -> streaming-response-ready (≈ time-to-first-audio
    // handoff), NOT full synthesis — the audio body streams AFTER this returns. Full
    // synthesis duration is the tts_complete [turn-timing] line. Awaited so the turn_logs
    // row is updated before the serverless response returns.
    if (turnId) {
      await recordRouteTotal(turnId, Date.now() - routeStart);
    }
    emitTurnTiming('route_total', Date.now() - routeStart, timingCtx);

    // Return streamed audio + the text headers (available immediately, before audio).
    return new NextResponse(audioStream, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
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

