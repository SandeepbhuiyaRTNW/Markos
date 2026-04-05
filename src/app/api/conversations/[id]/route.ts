import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * GET /api/conversations/[id]
 * Returns full transcript for a conversation
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const convResult = await query(
      `SELECT id, started_at, ended_at, summary, metadata, session_ended, takeaways, pondering_topics FROM conversations WHERE id = $1`,
      [id]
    );
    if (convResult.rows.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messagesResult = await query(
      `SELECT role, content, created_at, emotion_detected, kwml_archetype
       FROM messages WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return NextResponse.json({
      conversation: convResult.rows[0],
      messages: messagesResult.rows,
    });
  } catch (error) {
    console.error('Conversation detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch conversation' }, { status: 500 });
  }
}

/**
 * POST /api/conversations/[id]
 * End session: Generate summary, takeaways, pondering topics, and emotion arc
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Fetch messages + conversation metadata
    const [messagesResult, convResult] = await Promise.all([
      query(
        `SELECT role, content, emotion_detected FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
        [id]
      ),
      query(`SELECT user_id FROM conversations WHERE id = $1`, [id]),
    ]);

    if (messagesResult.rows.length === 0) {
      return NextResponse.json({ error: 'No messages in conversation' }, { status: 400 });
    }

    const userId = convResult.rows[0]?.user_id;
    const transcript = messagesResult.rows
      .map((m: { role: string; content: string }) => `${m.role === 'user' ? 'Him' : 'Marcus'}: ${m.content}`)
      .join('\n');

    // Build emotion arc from detected emotions
    const emotionArc = messagesResult.rows
      .filter((m: { role: string; emotion_detected: string | null }) => m.role === 'user' && m.emotion_detected)
      .map((m: { emotion_detected: string }) => m.emotion_detected);

    const messageCount = messagesResult.rows.length;
    const isShortSession = messageCount <= 4; // Opening + 1 exchange or less

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are summarizing a conversation between a man and Marcus (his Stoic AI companion).

CRITICAL RULES:
1. Your summary must be GROUNDED in the EXACT words he used. Quote him or paraphrase closely. Do NOT embellish or add literary prose he did not earn.
2. If the conversation was short (few exchanges), keep the summary proportionally short. Do NOT generate elaborate insights from a brief exchange.
3. Takeaways must reference SPECIFIC things he said or revealed — not generic Stoic philosophy.
4. Pondering topics must connect to HIS actual situation, using HIS words and context.${isShortSession ? '\n5. THIS WAS A SHORT SESSION. Keep everything minimal and honest. Do not over-interpret.' : ''}

Generate a JSON object with:
- "title": 3-6 words capturing what HE actually talked about. Use his language, not literary language. Good: "Feeling Lost at Work", "Can't Talk to His Wife". Bad: "The Weight of an Unlived Life", "Wrestling with Existential Purpose".
- "summary": 1-3 sentences describing what he ACTUALLY said and where the conversation went. Ground it in his real words.${isShortSession ? ' This was a short session — 1 sentence is fine.' : ''} Example: "He said he feels 'stuck' — work and home both feel flat. We started exploring what 'whatever' means to him and where the numbness began." BAD example: "He arrived weighed down by a sense of despair, grappling with the void of purpose."
- "takeaways": An array of 2-4 insights that emerged. Each must reference something HE said or a specific pattern that surfaced. Frame through Stoic lens but anchor in his reality.${isShortSession ? ' For short sessions, 1-2 takeaways is enough.' : ''} Good: "He used the word 'grinding' three times — his relationship with work has become purely mechanical. The Stoic question is whether this grinding serves his character or just his resume." Bad: "Skills can be built through dedication."
- "pondering_topics": 2-3 questions for him to sit with. These must reference HIS specific situation.${isShortSession ? ' For short sessions, 1-2 is enough.' : ''} Good: "You said 'I got nothing left' when you come home — what took it all? Is it the work itself, or something else?" Bad: "What does it mean to live a life of purpose?"
- "mood": One word — the emotional tone of HIS side of the conversation
- "stoic_principle": The most relevant Stoic principle (e.g. "Dichotomy of Control", "Amor Fati", "Memento Mori", "Obstacle is the Way")
- "topics": 2-4 topic labels based on what he actually discussed (e.g. ["work burnout", "marriage strain"])
Return ONLY valid JSON.`,
        },
        { role: 'user', content: transcript },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const raw = completion.choices[0].message.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```/g, '').trim());
    } catch {
      parsed = { title: 'Conversation', summary: raw, takeaways: [], pondering_topics: [], mood: 'reflective', stoic_principle: '', topics: [] };
    }

    // Ensure arrays exist
    parsed.takeaways = parsed.takeaways || [];
    parsed.pondering_topics = parsed.pondering_topics || [];
    parsed.topics = parsed.topics || [];

    // Save to conversations table
    await query(
      `UPDATE conversations
       SET summary = $1,
           ended_at = NOW(),
           session_ended = true,
           takeaways = $2,
           pondering_topics = $3,
           metadata = metadata || $4
       WHERE id = $5`,
      [
        parsed.summary,
        JSON.stringify(parsed.takeaways),
        JSON.stringify(parsed.pondering_topics),
        JSON.stringify({
          title: parsed.title,
          takeaways: parsed.takeaways,
          pondering_topics: parsed.pondering_topics,
          mood: parsed.mood,
          stoic_principle: parsed.stoic_principle,
          topics: parsed.topics,
          emotion_arc: emotionArc,
        }),
        id,
      ]
    );

    // Also save to session_notes for quick lookups
    if (userId) {
      await query(
        `INSERT INTO session_notes (conversation_id, user_id, summary, takeaways, pondering_topics, emotion_arc, stoic_principle, title, mood)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          id, userId, parsed.summary,
          JSON.stringify(parsed.takeaways),
          JSON.stringify(parsed.pondering_topics),
          JSON.stringify(emotionArc),
          parsed.stoic_principle || null,
          parsed.title,
          parsed.mood,
        ]
      );
    }

    return NextResponse.json(parsed);
  } catch (error) {
    console.error('End session error:', error);
    return NextResponse.json({ error: 'Failed to end session' }, { status: 500 });
  }
}

