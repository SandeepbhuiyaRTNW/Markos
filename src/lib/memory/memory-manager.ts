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
  - key: short label (e.g. "name", "job", "core_struggle")
  - value: the actual fact as a concise string
  - confidence: float 0.0-1.0

Memory Layers:
1-Identity: name, age, job, values, beliefs, personality traits
2-Relationships: partner, family, friends, colleagues, key people
3-Goals: aspirations, targets, dreams, what he wants to build
4-Challenges: struggles, fears, obstacles, what holds him back
5-Decision Patterns: how he tends to decide, recurring avoidance or action patterns
6-Wins: achievements, progress, breakthroughs, positive moments
7-KWML Profile: archetypal expressions observed (King/Warrior/Magician/Lover)

Only extract CLEAR, STATED facts — not interpretations. If nothing memory-worthy exists, return {"memories": []}.

Example: {"memories": [{"layer_number": 4, "key": "core_struggle", "value": "shuts down emotionally when wife tries to talk", "confidence": 0.9}]}`
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
}

