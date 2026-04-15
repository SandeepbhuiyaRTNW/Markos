import OpenAI from 'openai';
import { query } from '../db';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const MEMORY_LAYERS = {
  1: 'Identity',        // Who he is: name, age, values, beliefs
  2: 'Relationships',   // Key people in his life
  3: 'Goals',           // What he's working toward
  4: 'Challenges',      // What he's struggling with
  5: 'Decision Patterns', // How he tends to decide
  6: 'Wins',            // Victories and progress
  7: 'KWML Profile',    // Archetypal expression
} as const;

export async function storeMemory(
  userId: string,
  layerNumber: number,
  key: string,
  value: string,
  confidence: number = 0.5,
  sourceMessageId?: string
) {
  // Upsert: update if key exists for this user+layer, otherwise insert
  const existing = await query(
    `SELECT id FROM memory_layers WHERE user_id = $1 AND layer_number = $2 AND key = $3`,
    [userId, layerNumber, key]
  );

  if (existing.rows.length > 0) {
    // Confidence reinforcement: if the same key is stored again with a similar value, boost confidence
    const existingRow = await query(
      `SELECT value, confidence FROM memory_layers WHERE id = $1`,
      [existing.rows[0].id]
    );
    let newConfidence = confidence;
    if (existingRow.rows.length > 0) {
      const oldVal = (existingRow.rows[0].value || '').toLowerCase();
      const newVal = value.toLowerCase();
      // If value is similar or the same, reinforce confidence (max 1.0)
      if (oldVal === newVal || oldVal.includes(newVal) || newVal.includes(oldVal)) {
        newConfidence = Math.min(1.0, (existingRow.rows[0].confidence || 0.5) + 0.1);
      }
    }
    await query(
      `UPDATE memory_layers SET value = $1, confidence = $2, updated_at = NOW(), source_message_id = $3 WHERE id = $4`,
      [value, newConfidence, sourceMessageId, existing.rows[0].id]
    );
  } else {
    await query(
      `INSERT INTO memory_layers (user_id, layer_number, layer_name, key, value, confidence, source_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, layerNumber, MEMORY_LAYERS[layerNumber as keyof typeof MEMORY_LAYERS], key, value, confidence, sourceMessageId]
    );
  }
}

export async function getMemoryContext(userId: string): Promise<string> {
  // Fetch memories and session count in parallel
  const [memResult, sessionResult] = await Promise.all([
    query(
      `SELECT layer_number, layer_name, key, value, confidence, updated_at
       FROM memory_layers WHERE user_id = $1
       ORDER BY layer_number, confidence DESC`,
      [userId]
    ),
    query(
      `SELECT COUNT(*) as cnt FROM conversations WHERE user_id = $1`,
      [userId]
    ),
  ]);

  const sessionCount = parseInt(sessionResult.rows[0]?.cnt || '0', 10);

  if (memResult.rows.length === 0) {
    return sessionCount > 0
      ? `Session count: ${sessionCount}. No structured memories stored yet.`
      : 'No memories stored for this user yet.';
  }

  // Organize by layer
  const layers: Record<number, Array<{ key: string; value: string; confidence: number; updatedAt: string }>> = {};
  const highlights: string[] = [];

  for (const row of memResult.rows) {
    if (!layers[row.layer_number]) layers[row.layer_number] = [];
    layers[row.layer_number].push({
      key: row.key,
      value: row.value,
      confidence: parseFloat(row.confidence),
      updatedAt: row.updated_at,
    });
    // Collect high-confidence facts as highlights
    if (parseFloat(row.confidence) >= 0.8) {
      highlights.push(`${row.key}: ${row.value}`);
    }
  }

  let context = `SESSIONS TOGETHER: ${sessionCount}\nTOTAL MEMORIES: ${memResult.rows.length}`;

  // High-confidence highlights summary
  if (highlights.length > 0) {
    context += `\n\nKEY FACTS (high confidence):\n${highlights.slice(0, 10).map(h => `- ${h}`).join('\n')}`;
  }

  // Detailed layers
  for (const [layerNum, entries] of Object.entries(layers)) {
    const layerName = MEMORY_LAYERS[parseInt(layerNum) as keyof typeof MEMORY_LAYERS];
    context += `\n\n[Layer ${layerNum} - ${layerName}]`;
    for (const entry of entries) {
      const conf = entry.confidence >= 0.8 ? 'strong' : entry.confidence >= 0.5 ? 'moderate' : 'weak';
      context += `\n${entry.key}: ${entry.value} (${conf})`;
    }
  }

  return context;
}

/**
 * Search past user messages for specific details that may not be in memory layers.
 * Uses embedding similarity to find relevant past statements.
 */
export async function searchPastMessages(
  userId: string,
  searchQuery: string,
  limit: number = 5,
): Promise<string[]> {
  try {
    // Get embedding for search query
    const embResp = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: searchQuery,
      dimensions: 256,
    });
    const queryEmb = embResp.data[0].embedding;

    // Get recent user messages (last 100)
    const msgResult = await query(
      `SELECT m.content, m.created_at, c.session_number
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = $1 AND m.role = 'user' AND length(m.content) > 10
       ORDER BY m.created_at DESC LIMIT 100`,
      [userId]
    );

    if (msgResult.rows.length === 0) return [];

    // Embed all messages
    const contents = msgResult.rows.map(r => r.content);
    const msgEmbResp = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: contents,
      dimensions: 256,
    });

    // Score by similarity
    const scored = msgEmbResp.data.map((d, i) => {
      let dot = 0, magA = 0, magB = 0;
      for (let j = 0; j < queryEmb.length; j++) {
        dot += queryEmb[j] * d.embedding[j];
        magA += queryEmb[j] * queryEmb[j];
        magB += d.embedding[j] * d.embedding[j];
      }
      const sim = dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10);
      return { content: contents[i], session: msgResult.rows[i].session_number, sim };
    });

    // Return top matches above threshold
    return scored
      .filter(s => s.sim > 0.45)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit)
      .map(s => `[Session #${s.session}] "${s.content}"`);
  } catch (err) {
    console.warn('[Memory] searchPastMessages failed:', err);
    return [];
  }
}

/**
 * Build a narrative session history from ALL past sessions.
 * Returns a structured summary of the journey so far, not just the last session.
 */
export async function getSessionHistory(userId: string): Promise<string> {
  try {
    const result = await query(
      `SELECT session_number, summary, metadata, takeaways, pondering_topics, ended_at
       FROM conversations
       WHERE user_id = $1 AND session_ended = true AND summary IS NOT NULL
       ORDER BY ended_at ASC
       LIMIT 20`,
      [userId]
    );

    if (result.rows.length === 0) {
      return 'No previous sessions. This is the beginning of your relationship.';
    }

    let history = `YOU HAVE HAD ${result.rows.length} PREVIOUS SESSION(S) WITH THIS MAN.\n\nSESSION-BY-SESSION JOURNEY:\n`;

    for (const row of result.rows) {
      const md = (row.metadata || {}) as Record<string, unknown>;
      const title = (md.title as string) || `Session ${row.session_number}`;
      const date = row.ended_at ? new Date(row.ended_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';

      history += `\n--- Session #${row.session_number} (${date}): "${title}" ---\n`;
      if (row.summary) history += `What happened: ${row.summary}\n`;

      const takeaways: string[] = row.takeaways || [];
      if (takeaways.length > 0) {
        history += `Key takeaways: ${takeaways.join(' | ')}\n`;
      }

      const pondering: string[] = row.pondering_topics || [];
      if (pondering.length > 0) {
        history += `Left him pondering: ${pondering.join(' | ')}\n`;
      }
    }

    history += `\n--- END OF SESSION HISTORY ---\n`;
    history += `Use this history to recognize patterns across sessions, reference specific past conversations naturally, and show that you remember the full arc of his journey — not just isolated moments.`;

    return history;
  } catch (err) {
    console.warn('[Memory] getSessionHistory failed:', err);
    return 'Session history unavailable.';
  }
}

/**
 * Get user style preferences from memory layers.
 * These are conversational preferences the user has expressed (e.g., "stop asking questions").
 */
export async function getStylePreferences(userId: string): Promise<string> {
  try {
    const result = await query(
      `SELECT key, value FROM memory_layers
       WHERE user_id = $1 AND key LIKE 'style_%'
       ORDER BY updated_at DESC`,
      [userId]
    );

    if (result.rows.length === 0) return '';

    return result.rows.map(r => `- ${r.value}`).join('\n');
  } catch {
    return '';
  }
}

export async function extractMemories(
  userId: string,
  userMessage: string,
  marcusResponse: string,
  messageId: string
) {
  // Use GPT to extract memory-worthy information
  const extraction = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Extract memory-worthy facts from this conversation exchange.
Return JSON with a "memories" key containing an array of objects. Each object must have:
  - layer_number: integer 1-7
  - key: short label (e.g. "name", "job", "core_struggle", "wife_threat")
  - value: the actual fact — USE HIS EXACT WORDS for high-impact statements
  - confidence: float 0.0-1.0

CRITICAL RULES:
1. PRESERVE SPECIFICS — do NOT generalize. "Wife will divorce me" must stay as "wife will divorce me", not become "marriage tension".
2. HIGH-IMPACT DETAILS get priority: threats, ultimatums, crises, specific events, specific names, specific fears, specific dreams.
3. Use HIS words in the value field, not your interpretation. If he said "my wife will divorce me if I become a chef" — store exactly that.
4. Each specific fact gets its OWN memory entry. Don't combine "wants to be a chef" and "wife threatens divorce" into one entry.

Memory Layers:
1-Identity: name, age, job, values, beliefs, personality traits
2-Relationships: partner, family, friends, colleagues, key people. INCLUDE: specific things they said/did, threats, support, conflicts
3-Goals: aspirations, targets, dreams, what he wants to build
4-Challenges: struggles, fears, obstacles, what holds him back. INCLUDE: specific threats, ultimatums, deadlines, consequences
5-Decision Patterns: how he tends to decide, recurring avoidance or action patterns
6-Wins: achievements, progress, breakthroughs, positive moments
7-KWML Profile: archetypal expressions observed (King/Warrior/Magician/Lover)

Only extract CLEAR, STATED facts — not interpretations. If nothing memory-worthy exists, return {"memories": []}.

Example: {"memories": [
  {"layer_number": 2, "key": "wife_ultimatum", "value": "wife will divorce him if he pursues becoming a chef", "confidence": 1.0},
  {"layer_number": 3, "key": "dream", "value": "wants to become a chef and create a food truck", "confidence": 1.0},
  {"layer_number": 4, "key": "core_fear", "value": "afraid of losing marriage if he follows his dream", "confidence": 0.9}
]}`
      },
      {
        role: 'user',
        content: `User said: "${userMessage}"\nMarcus responded: "${marcusResponse}"`
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });

  try {
    const content = extraction.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);

    // Robustly find the memories array regardless of what key GPT used
    let memories: Array<{ layer_number: number; key: string; value: string; confidence?: number }> = [];
    if (Array.isArray(parsed)) {
      memories = parsed;
    } else {
      // Find the first array value in the object (handles "memories", "extractions", "data", etc.)
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val)) {
          memories = val as typeof memories;
          break;
        }
      }
    }

    console.log(`[Memory] Extracted ${memories.length} memories for user ${userId}`);

    for (const mem of memories) {
      if (mem.layer_number && mem.key && mem.value) {
        await storeMemory(userId, mem.layer_number, mem.key, mem.value, mem.confidence ?? 0.5, messageId);
      }
    }
  } catch (e) {
    console.error('[Memory] Extraction failed:', e);
  }

  // ─── STYLE PREFERENCE DETECTION ───
  // Detect if the user expressed preferences about how Marcus should communicate
  try {
    const stylePatterns: Array<{ pattern: RegExp; key: string; value: string }> = [
      { pattern: /stop asking (me )?questions/i, key: 'style_no_questions', value: 'He asked Marcus to stop ending responses with questions. Respect this.' },
      { pattern: /just listen/i, key: 'style_just_listen', value: 'He wants Marcus to listen without asking questions or giving advice. Just be present.' },
      { pattern: /don'?t (end|finish).*(question)/i, key: 'style_no_ending_questions', value: 'He does not want responses to end with questions.' },
      { pattern: /don'?t (give me|need).*(advice|wisdom|high level)/i, key: 'style_no_advice', value: 'He does not want unsolicited advice or high-level wisdom. Just be real and present.' },
      { pattern: /can you just (be here|listen|hear me)/i, key: 'style_presence', value: 'He wants presence and active listening, not probing or guiding.' },
    ];

    for (const { pattern, key, value } of stylePatterns) {
      if (pattern.test(userMessage)) {
        await storeMemory(userId, 5, key, value, 0.95, messageId);
        console.log(`[Memory] 🎯 Style preference stored: ${key}`);
      }
    }
  } catch (e) {
    console.warn('[Memory] Style preference detection failed:', e);
  }
}

