import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { query } from '@/lib/db';
import { getMemoryContext } from '@/lib/memory/memory-manager';
import { synthesizeSpeech } from '@/lib/voice/tts';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * GET /api/conversation/opening?userId=X&skipTts=true
 *
 * Generates Marcus's contextual opening message for the session.
 * Looks up or creates the user's persistent conversation.
 * References memory from all previous sessions.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId');
    const skipTts = req.nextUrl.searchParams.get('skipTts') === 'true';

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Fetch user info
    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [userId]);
    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const userName: string | null = userResult.rows[0].name || null;

    // Create a new conversation for this session (each opening = new session)
    let conversationId: string;
    const countResult = await query(
      `SELECT COUNT(*) as cnt FROM conversations WHERE user_id = $1`,
      [userId]
    );
    const sessionNumber = parseInt(countResult.rows[0].cnt, 10) + 1;

    const created = await query(
      `INSERT INTO conversations (user_id, session_number) VALUES ($1, $2) RETURNING id`,
      [userId, sessionNumber]
    );
    conversationId = created.rows[0].id;

    // Fetch memory context
    const memoryContext = await getMemoryContext(userId);
    const hasMemory = !memoryContext.includes('No memories stored');

    // Fetch last 3 messages from the conversation (to understand recency)
    const recentResult = await query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 6`,
      [conversationId]
    );
    const recentMessages = recentResult.rows.reverse();
    const hasHistory = recentMessages.length > 0;

    // Build the opening prompt using the full Marcus persona
    const recentSection = hasHistory
      ? `\n\nMOST RECENT EXCHANGE (for context):\n${recentMessages.map(m => `${m.role === 'marcus' ? 'Marcus' : 'User'}: ${m.content}`).join('\n')}`
      : '';

    const openingInstruction = hasMemory
      ? `\n\n## YOUR TASK — OPEN THIS SESSION\nYou are speaking first. The man has just arrived. Reference something SPECIFIC from your memory — a struggle, a pattern, a commitment — so he knows you have been thinking about him. Keep it to 2-3 sentences. End with ONE grounded question.${recentSection}`
      : `\n\n## YOUR TASK — OPEN THIS SESSION\nThis is your first conversation with this man. Speak first. Set the tone for what this relationship will become. Welcome him with weight and purpose — not warmth for warmth's sake, but genuine gravity. 2-3 sentences maximum. End with ONE question that begins to open him up.`;

    const systemPrompt = buildSystemPrompt({
      userName: userName || undefined,
      memoryContext: memoryContext,
    }) + openingInstruction;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.7,
      max_tokens: 150,
      messages: [{ role: 'system', content: systemPrompt }],
    });

    const rawText = completion.choices[0].message.content?.trim() || '';
    // Strip any "Marcus: " or "Marcus Aurelius: " prefix the model may add
    const openingText = rawText.replace(/^Marcus(?: Aurelius)?:\s*/i, '')
      || (userName ? `${userName}, good to have you back. What has been on your mind?` : 'Brother, I have been waiting. What is on your mind?');

    // Store Marcus's opening message in the conversation
    await query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'marcus', $2)`,
      [conversationId, openingText]
    );

    // Optionally synthesize speech
    if (!skipTts) {
      try {
        const audioBuffer = await synthesizeSpeech(openingText);
        return new NextResponse(new Uint8Array(audioBuffer), {
          headers: {
            'Content-Type': 'audio/mpeg',
            'X-Marcus-Text': encodeURIComponent(openingText),
            'X-Conversation-Id': conversationId,
          },
        });
      } catch {
        // Fall through to JSON response if TTS fails
      }
    }

    return NextResponse.json({
      marcusText: openingText,
      conversationId,
    });

  } catch (error) {
    console.error('[Opening] Error:', error);
    return NextResponse.json({ error: 'Failed to generate opening' }, { status: 500 });
  }
}

