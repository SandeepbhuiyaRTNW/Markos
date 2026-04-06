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
    const sessionType = req.nextUrl.searchParams.get('sessionType') || 'continue';
    const continueFrom = req.nextUrl.searchParams.get('continueFrom');

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
    // Only reuse if same continueFrom + sessionType (prevents switching sessions within 30s returning stale data)
    const recentResult = await query(
      `SELECT id, session_number FROM conversations
       WHERE user_id = $1 AND started_at > NOW() - INTERVAL '30 seconds'
         AND (parent_session_id IS NOT DISTINCT FROM $2)
         AND (metadata->>'sessionType' IS NOT DISTINCT FROM $3)
       ORDER BY started_at DESC LIMIT 1`,
      [userId, continueFrom || null, sessionType]
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
        `INSERT INTO conversations (user_id, session_number, metadata, parent_session_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, sessionNumber, JSON.stringify({ sessionType }), continueFrom || null]
      );
      conversationId = created.rows[0].id;
    }

    // Fetch memory context + session to continue from + last few messages
    const lastSessionQuery = continueFrom
      ? query(
          // Specific session chosen by user
          `SELECT takeaways, pondering_topics, summary, metadata
           FROM conversations
           WHERE id = $1 AND user_id = $2 AND session_ended = true`,
          [continueFrom, userId]
        )
      : query(
          // Default: most recent ended session
          `SELECT takeaways, pondering_topics, summary, metadata
           FROM conversations
           WHERE user_id = $1 AND session_ended = true AND id != $2
           ORDER BY ended_at DESC LIMIT 1`,
          [userId, conversationId]
        );

    const [memoryContext, prevResult, lastSessionResult] = await Promise.all([
      getMemoryContext(userId),
      continueFrom
        ? query(
            // Get messages from the SPECIFIC session being continued
            `SELECT m.role, m.content FROM messages m
             WHERE m.conversation_id = $1
             ORDER BY m.created_at DESC LIMIT 6`,
            [continueFrom]
          )
        : query(
            `SELECT m.role, m.content FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE c.user_id = $1 AND m.conversation_id != $2
             ORDER BY m.created_at DESC LIMIT 6`,
            [userId, conversationId]
          ),
      lastSessionQuery,
    ]);
    // Determine if we have REAL memories (not just session count metadata)
    const hasMemory = !memoryContext.includes('No memories stored')
      && !memoryContext.includes('No structured memories stored')
      && memoryContext.includes('[Layer');  // actual memory layers present
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
    if (sessionType === 'fresh') {
      const nameGreeting = userName ? `You know this man as ${userName}. ` : '';
      openingInstruction = `\n\n## YOUR TASK — OPEN THIS SESSION (NEW TOPIC)
${nameGreeting}He has chosen to start a NEW topic today — do NOT reference previous conversations, past struggles, or pondering topics. He wants a clean start on something different.
Your job: Open with warmth and curiosity. Acknowledge that today is about something new. Invite him to bring whatever is on his mind RIGHT NOW.
Keep it to 2-3 sentences. End with ONE open question like "What's on your mind today?" or "What brought you here today?"
Do NOT say "I remember" or reference past sessions. Do NOT start with "Brother" — vary your openings.`;
    } else if (continueFrom) {
      // ─── CONTINUING FROM A SPECIFIC SESSION ───
      // The user explicitly chose this session to continue from.
      // ONLY reference this session's data, not general memory.
      if (lastPondering.length > 0) {
        openingInstruction = `\n\n## YOUR TASK — CONTINUE FROM A SPECIFIC SESSION
He has chosen to CONTINUE from a previous conversation titled "${lastTitle}".
CRITICAL: Reference ONLY the pondering topics and takeaways from THAT session. Do NOT reference other sessions or general memory.

SESSION TO CONTINUE FROM:
${continuitySection}
${recentSection}

Open by referencing one of the pondering topics DIRECTLY. Ask him if he had time to sit with it. Be specific — use his words.
2-3 sentences. End with ONE question. Do NOT start with "Brother" — vary your openings.`;
      } else {
        openingInstruction = `\n\n## YOUR TASK — CONTINUE FROM A SPECIFIC SESSION
He has chosen to CONTINUE from a previous conversation titled "${lastTitle}".
CRITICAL: Reference ONLY what was discussed in THAT session. Do NOT reference other sessions or general memory.

LAST SESSION EXCHANGE:
${recentSection}

Open by referencing something specific from that conversation. What did he say? What was he working through? Ask him how things have been since then.
2-3 sentences. End with ONE question. Do NOT start with "Brother" — vary your openings.`;
      }
    } else if (lastPondering.length > 0) {
      openingInstruction = `\n\n## YOUR TASK — OPEN THIS SESSION\nYou are speaking first. The man has just arrived. He was given specific topics to ponder since your last conversation. Reference one of the pondering topics DIRECTLY — ask him if he had time to sit with it, what came up for him when he thought about it. Be specific, not generic. Keep it to 2-3 sentences. End with ONE question about his reflection. Do NOT start with "Brother" — vary your openings.${continuitySection}${recentSection}`;
    } else if (hasMemory && hasPrevHistory) {
      openingInstruction = `\n\n## YOUR TASK — OPEN THIS SESSION\nYou are speaking first. The man has just arrived. Reference something SPECIFIC from the memory context below — a struggle, a pattern, a commitment — so he knows you have been thinking about him. ONLY reference things that are explicitly stated in your memory context. Do NOT invent or assume any memories. Keep it to 2-3 sentences. End with ONE grounded question. Do NOT start with "Brother" — vary your openings.${continuitySection}${recentSection}`;
    } else {
      openingInstruction = `\n\n## YOUR TASK — OPEN THIS SESSION\nThis is your first conversation with this man. You have NO prior memory of him — do NOT pretend you remember anything or reference any past sessions. Speak first. Set the tone for what this relationship will become. Welcome him with weight and purpose — not warmth for warmth's sake, but genuine gravity. 2-3 sentences maximum. End with ONE question that begins to open him up. Do NOT start with "Brother" — vary your openings. CRITICAL: Do NOT say "I remember" or reference anything from past conversations — there are none.`;
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

