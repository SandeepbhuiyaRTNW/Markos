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
    const userMessageCount = messagesResult.rows.filter(
      (r: { role: string }) => r.role === 'user'
    ).length;
    const isShortSession = userMessageCount <= 2;

    let systemPrompt: string;

    if (isShortSession) {
      systemPrompt = `You are summarizing a VERY SHORT conversation between a man and Marcus (his Stoic AI companion). The man only said ${userMessageCount} thing(s). Be BRUTALLY honest about how little content there is. Do NOT pad, embellish, or over-interpret.

RULES FOR SHORT SESSIONS:
- Summary: ONE sentence max. Just state what he said in his own words.
- Takeaways: 1 item ONLY. Must quote or closely paraphrase his actual words. If he only said one sentence, the takeaway is essentially that sentence and what it might point to.
- Pondering topics: 1 topic ONLY. Must directly use his words as the starting point.
- Do NOT generate philosophical insights from a single sentence.
- Do NOT add Stoic framing beyond the stoic_principle field.

Generate a JSON object:
- "title": 3-5 words using HIS words. Example: if he said "I'm really depressed" -> "Feeling Really Depressed"
- "summary": 1 sentence. What did he actually say? Example: "He said he's 'really depressed' and doesn't know what to do."
- "takeaways": Array with exactly 1 item. Quote him and note what's unresolved. Example: ["He came in saying 'I don't know what to do' — we haven't yet explored what's behind the depression or what 'doing something' would look like for him."]
- "pondering_topics": Array with exactly 1 item. Use his words. Example: ["You said you 'don't know what to do' — if you could change one thing about tomorrow, what would it be?"]
- "mood": One word
- "stoic_principle": Most relevant Stoic principle
- "topics": 1-2 topic labels from what he actually said
Return ONLY valid JSON.`;
    } else {
      systemPrompt = `You are summarizing a conversation between a man and Marcus (his Stoic AI companion).

CRITICAL RULES:
1. Summary must use the EXACT words he used. Quote him directly.
2. Takeaways must reference SPECIFIC things he said — not generic philosophy.
3. Pondering topics must use HIS words and situation, not abstract questions.
4. The depth of your summary must match the depth of the conversation. Don't create meaning that wasn't there.
5. You MUST identify the core PATTERN (the loop he's stuck in) — not abstract concepts.
6. You MUST provide a concrete ACTION PLAN with specific behaviors, frequency, and duration.
7. You MUST include a FEEDBACK CHECK — how he should evaluate whether it's working.

Generate a JSON object:
- "title": 3-6 words using HIS language. Good: "Can't Talk to His Wife". Bad: "The Weight of an Unlived Life".
- "summary": 2-3 sentences. What he said (quote him), what emerged, where it ended.
- "takeaways": 2-4 insights. Each MUST quote or closely paraphrase something he said.
- "pondering_topics": 2-3 questions using HIS words. Example: "You said 'I got nothing left' when you come home — what took it all?"
- "pattern": The specific behavioral loop he's stuck in. Must be concrete, not abstract. Format: "X → Y → Z → back to X". Example: "He avoids slowing down → unprocessed thoughts pile up → overwhelm builds → he pushes through harder → more avoidance". Use HIS words where possible.
- "action_plan": An object with these fields:
  - "actions": Array of 1-3 specific, trackable steps. Each must include WHAT, WHEN, HOW LONG. Example: ["10-15 min walk daily — no phone, focus on steps and breathing", "After each walk, ask: 'Do I feel even 1% lighter?'"]
  - "when_to_use": Array of 2-4 specific triggers/situations when he should use this plan. Must reference HIS feelings/situations from the conversation. Example: ["When you feel that 'cluttered' heaviness you described", "When you catch yourself pushing through without pausing", "Anytime you feel stuck or empty"]
  - "frequency": A single clear statement. Example: "Once daily, or anytime you feel stuck" or "Every morning before work, and once more if the heaviness returns"
  - "fallback": What to do if the plan doesn't work. Must be a NEXT action, not overthinking. Example: "If the walk doesn't shift anything — do one more small physical action: shower, drink water, change rooms. The goal is motion, not perfection."
  - "real_goal": Reframe what success actually looks like. NOT "feel better." Example: "Not to fix everything — just to move despite feeling nothing. The goal is breaking the avoidance loop, not instant relief."
- "check_in": A single question he should ask himself in 3-5 days to evaluate whether the action plan is working. Must be specific and binary-answerable. Example: "After 5 days: did taking walks reduce the 'cluttered' feeling you described, even slightly?"
- "mood": One word
- "stoic_principle": Most relevant Stoic principle
- "topics": 2-4 topic labels from what he actually discussed
Return ONLY valid JSON.`;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const raw = completion.choices[0].message.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```/g, '').trim());
    } catch {
      parsed = { title: 'Conversation', summary: raw, takeaways: [], pondering_topics: [], mood: 'reflective', stoic_principle: '', topics: [] };
    }

    // Ensure arrays/objects exist
    parsed.takeaways = parsed.takeaways || [];
    parsed.pondering_topics = parsed.pondering_topics || [];
    parsed.topics = parsed.topics || [];
    parsed.pattern = parsed.pattern || '';
    parsed.check_in = parsed.check_in || '';
    // Normalize action_plan: could be old format (array) or new format (object)
    if (Array.isArray(parsed.action_plan)) {
      parsed.action_plan = { actions: parsed.action_plan, when_to_use: [], frequency: '', fallback: '', real_goal: '' };
    }
    parsed.action_plan = parsed.action_plan || { actions: [], when_to_use: [], frequency: '', fallback: '', real_goal: '' };

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
          pattern: parsed.pattern,
          action_plan: parsed.action_plan,
          check_in: parsed.check_in,
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

