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

    // ─── RATE-LIMIT: Prevent ghost session creation ───
    // If a conversation was created for this user within the last 30 seconds, reuse it
    const recentResult = await query(
      `SELECT id, session_number FROM conversations
       WHERE user_id = $1 AND started_at > NOW() - INTERVAL '30 seconds'
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );

    let conversationId: string;
    let sessionNumber: number;

    if (recentResult.rows.length > 0) {
      // Reuse the recently created conversation instead of creating a duplicate
      conversationId = recentResult.rows[0].id;
      sessionNumber = recentResult.rows[0].session_number;
      console.log(`[Opening] ♻️ Reusing recent conversation ${conversationId} (created <30s ago)`);

      // Check if it already has an opening message — if so, return it directly
      const existingMsg = await query(
        `SELECT content FROM messages WHERE conversation_id = $1 AND role = 'marcus' ORDER BY created_at ASC LIMIT 1`,
        [conversationId]
      );
      if (existingMsg.rows.length > 0) {
        const openingText = existingMsg.rows[0].content;
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
          } catch { /* fall through */ }
        }
        return NextResponse.json({ marcusText: openingText, conversationId });
      }
    } else {
      // Create a new conversation for this session
      const countResult = await query(
        `SELECT COUNT(*) as cnt FROM conversations WHERE user_id = $1`,
        [userId]
      );
      sessionNumber = parseInt(countResult.rows[0].cnt, 10) + 1;

      const created = await query(
        `INSERT INTO conversations (user_id, session_number) VALUES ($1, $2) RETURNING id`,
        [userId, sessionNumber]
      );
      conversationId = created.rows[0].id;
    }

    // Fetch memory context + last session's takeaways + last few messages
    const [memoryContext, prevResult, lastSessionResult] = await Promise.all([
      getMemoryContext(userId),
      query(
        `SELECT m.role, m.content FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = $1 AND m.conversation_id != $2
         ORDER BY m.created_at DESC LIMIT 6`,
        [userId, conversationId]
      ),
      // Get last completed session's takeaways and pondering topics
      query(
        `SELECT takeaways, pondering_topics, summary, metadata
         FROM conversations
         WHERE user_id = $1 AND session_ended = true AND id != $2
         ORDER BY ended_at DESC LIMIT 1`,
        [userId, conversationId]
      ),
    ]);
    const hasMemory = !memoryContext.includes('No memories stored');
    const prevMessages = prevResult.rows.reverse();
    const hasPrevHistory = prevMessages.length > 0;

    // Extract last session's takeaways and pondering topics
    const lastSession = lastSessionResult.rows[0] || null;
    const lastTakeaways: string[] = lastSession?.takeaways || [];
    const lastPondering: string[] = lastSession?.pondering_topics || [];
    const lastTitle = (lastSession?.metadata as Record<string, unknown>)?.title || '';

    // Build the opening prompt using the full Marcus persona
    const recentSection = hasPrevHistory
      ? `\n\nLAST SESSION EXCHANGE (for continuity):\n${prevMessages.map((m: { role: string; content: string }) => `${m.role === 'marcus' ? 'Marcus' : 'User'}: ${m.content}`).join('\n')}`
      : '';

    // Build continuity section from last session's takeaways
    let continuitySection = '';
    if (lastTakeaways.length > 0 || lastPondering.length > 0) {
      continuitySection = '\n\nLAST SESSION CONTINUITY:';
      if (lastTitle) continuitySection += `\nLast session topic: "${lastTitle}"`;
      if (lastTakeaways.length > 0) continuitySection += `\nKey takeaways from last time:\n${lastTakeaways.map(t => `- ${t}`).join('\n')}`;
      if (lastPondering.length > 0) continuitySection += `\nPondering topics given to him:\n${lastPondering.map(t => `- ${t}`).join('\n')}`;
    }

    let openingInstruction: string;
    if (lastPondering.length > 0) {
      // Returning user with pondering topics from last session
      openingInstruction = `\n\n## YOUR TASK — OPEN THIS SESSION\nYou are speaking first. The man has just arrived. He was given specific topics to ponder since your last conversation. Reference one of the pondering topics DIRECTLY — ask him if he had time to sit with it, what came up for him when he thought about it. Be specific, not generic. Keep it to 2-3 sentences. End with ONE question about his reflection. Do NOT start with "Brother" — vary your openings.${continuitySection}${recentSection}`;
    } else if (hasMemory) {
      openingInstruction = `\n\n## YOUR TASK — OPEN THIS SESSION\nYou are speaking first. The man has just arrived. Reference something SPECIFIC from your memory — a struggle, a pattern, a commitment — so he knows you have been thinking about him. Keep it to 2-3 sentences. End with ONE grounded question. Do NOT start with "Brother" — vary your openings.${continuitySection}${recentSection}`;
    } else {
      openingInstruction = `\n\n## YOUR TASK — OPEN THIS SESSION\nThis is your first conversation with this man. Speak first. Set the tone for what this relationship will become. Welcome him with weight and purpose — not warmth for warmth's sake, but genuine gravity. 2-3 sentences maximum. End with ONE question that begins to open him up. Do NOT start with "Brother" — vary your openings.`;
    }

    const systemPrompt = buildSystemPrompt({
      userName: userName || undefined,
      memoryContext: memoryContext,
    }) + openingInstruction;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.75,
      max_tokens: 200,
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

