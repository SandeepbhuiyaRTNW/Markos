import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import OpenAI from 'openai';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

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
      systemPrompt = `You are writing the short after-note a man reads when he looks back on a VERY SHORT conversation he had with Marcus (his Stoic companion). He only said ${userMessageCount} thing(s). Write TO HIM — second person — and be honest about how little there is. Do NOT pad, embellish, or over-interpret.

VOICE (the whole point): address him directly as "you", never third person ("He said…", "the man"). Use his exact words, quoted back to him.

RULES FOR SHORT SESSIONS:
- Summary: ONE sentence, second person. Example: "You said you're 'really depressed' and don't know what to do."
- Takeaways: 1 item ONLY, in HIS words — something HE said, never a line Marcus said back. Example: ["You came in saying 'I don't know what to do' — we didn't get to what's behind it yet."]
- Pondering: 1 item ONLY, his words, second person.
- Do NOT generate philosophy from a single sentence.

Generate a JSON object:
- "title": 3-5 words naming the THING ITSELF in his words — not a case-note heading. He said "I'm really depressed" -> "The depression, and not knowing". NEVER "His/He".
- "summary": 1 sentence, second person (see rules).
- "takeaways": array with exactly 1 item, his words, second person, never Marcus's line.
- "pondering_topics": array with exactly 1 item, his words, second person. Example: ["You said you 'don't know what to do' — if you could change one thing about tomorrow, what would it be?"]
- "mood": One word
- "stoic_principle": Most relevant Stoic principle
- "topics": 1-2 topic labels from what he actually said
Return ONLY valid JSON.`;
    } else {
      systemPrompt = `You are writing the after-note a man reads when he looks back on a conversation he had with Marcus (his Stoic companion). You are writing TO HIM, not about him.

VOICE — THIS IS THE WHOLE POINT:
1. Address him directly, SECOND PERSON: "You said you miss your family. Four years is a long time." NEVER third person ("He expressed…", "the burden he carries", "the man").
2. Use the EXACT words he used — quote him back to himself.
3. A title is the THING ITSELF, in his frame — not a case-note heading. Good: "Four years since you've seen them". Bad: "Missing His Family", "The Weight of an Unlived Life".
4. Match the depth of the conversation. Don't create meaning that wasn't there.
5. Identify the core PATTERN (the loop he's stuck in), addressed to him, concrete not abstract.
6. Give a concrete ACTION PLAN with specific behaviors, frequency, and duration — addressed to him.
7. Include a FEEDBACK CHECK — how HE should evaluate whether it's working.

Generate a JSON object:
- "title": 3-7 words naming the THING ITSELF, in his words — a plain noun phrase or second person, NEVER "His/He". Good: "The loan, and your brother". Bad: "Can't Talk to His Wife", "The Weight of an Unlived Life".
- "summary": 2-3 sentences, TO HIM. What you heard him say (quote him), what surfaced, where it left off. "You said…", "you".
- "takeaways": 2-4 short lines, each in HIS OWN words or a realization HE reached, addressed to him ("You said…", "You keep coming back to…"). CRITICAL: every takeaway is something HE said or landed on — NEVER a line Marcus said back to him. Do not quote Marcus at him.
- "pondering_topics": 2-3 questions in HIS words, second person. Example: "You said 'I got nothing left' when you come home — what took it all?"
- "pattern": The behavioral loop, addressed to him, second person, concrete. Format: "X → Y → Z → back to X". Example: "You avoid slowing down → the thoughts pile up → the weight builds → you push harder → more avoidance". Use HIS words where possible.
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

    const completion = await getOpenAI().chat.completions.create({
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

