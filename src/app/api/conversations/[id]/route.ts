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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are summarizing a conversation between a man and Marcus Aurelius (his Stoic AI companion). You must write from a STOIC philosophical perspective — not generic self-help or therapy language.

Generate a JSON object with:
- "title": A brief 3-6 word title capturing the core theme. Use Stoic weight, not therapy-speak. Good: "Wrestling with Career Purpose", "The Weight of an Unlived Life". Bad: "Finding Balance at Work", "Improving Communication".
- "summary": A 2-3 sentence summary written as Marcus Aurelius would reflect on it. Reference what the man revealed and what Stoic truth emerged. Example: "He came bearing the weight of inadequacy at work — measuring himself against standards no one set. Through our exchange, the dichotomy of control surfaced: his skills are within his power, his colleagues' opinions are not."
- "takeaways": An array of 3-5 insights framed through Stoic philosophy. Each must reference a Stoic concept or principle. BANNED: generic coaching language like "Skills can be built", "Communication is key", "Take time for yourself", "Set boundaries". REQUIRED: Stoic framing like "What is in your control is your effort and your character — not the judgment of others (Dichotomy of Control)", "The obstacle before you IS the way forward — your discomfort at work is the training ground (Obstacle is the Way)".
- "pondering_topics": An array of 2-3 deep, open-ended questions for him to sit with. These must be philosophical, not actionable. Good: "If you stripped away every title and role — father, employee, husband — who remains? Is that man enough?", "What would Marcus Aurelius say to you if he saw you measuring your worth by your salary?". Bad: "How can you improve your work skills?", "What steps can you take to feel better?"
- "mood": The overall emotional tone (one word)
- "stoic_principle": The most relevant Stoic principle (e.g. "Dichotomy of Control", "Amor Fati", "Memento Mori", "Premeditatio Malorum", "Obstacle is the Way", "Sympatheia")
- "topics": An array of 2-4 topic labels for this conversation (e.g. ["work identity", "impostor syndrome", "self-worth"])
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

