import OpenAI from 'openai';
import { query } from '../db';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

// Local copy of the layer-number -> name map (kept here instead of importing
// MEMORY_LAYERS from memory-manager so this module stays import-safe in both
// directions: memory-manager imports applyCorrections from this file).
const LAYER_NAMES: Record<number, string> = {
  1: 'Identity',
  2: 'Relationships',
  3: 'Goals',
  4: 'Challenges',
  5: 'Decision Patterns',
  6: 'Wins',
  7: 'KWML Profile',
};

/**
 * Correction handling for the 7-layer memory store.
 *
 * The failure this fixes: Marcus states a wrong fact about the man's life
 * (e.g. a brother's name), the man corrects him, and twenty minutes later
 * Marcus repeats the original mistake. Root cause: the general extraction
 * pass treats a correction as just another fact. It can store the corrected
 * value under a NEW key while the wrong value lives on under the old key —
 * often at higher confidence — so getMemoryContext keeps surfacing the
 * mistake, and even when the key matches, the corrected value inherits the
 * old row's confidence instead of dominating.
 *
 * The fix has three parts:
 *   1. detectCorrectionSignal — a cheap regex gate so ordinary turns pay
 *      zero extra LLM cost.
 *   2. applyCorrections — a focused LLM pass that sees the man's EXISTING
 *      memories, maps the correction onto the row it replaces (or inserts a
 *      new row when the fact was never stored), writes it at confidence 1.0,
 *      and marks the row metadata with {corrected, previous_value}.
 *   3. getMemoryContext (in memory-manager.ts) surfaces corrected rows in a
 *      dedicated CORRECTIONS section at the top of the memory context, so the
 *      Composer cannot miss them.
 *
 * Corrected rows are pinned at confidence 1.0: a correction is the man
 * telling us the ground truth about his own life, and it must outrank every
 * extracted or inferred value.
 */

export interface MemoryRow {
  id: string;
  layer_number: number;
  key: string;
  value: string;
  confidence: number;
}

export interface ParsedCorrection {
  match_key: string | null;
  layer_number: number;
  key: string;
  corrected_value: string;
}

export interface CorrectionTarget {
  action: 'update' | 'insert';
  id?: string;
  previous_value?: string;
  layer_number: number;
  key: string;
  value: string;
}

/**
 * Cheap lexical gate. Deliberately a little broad — a false positive costs
 * one gpt-4o-mini call that returns zero corrections; a false negative means
 * Marcus repeats a mistake he was explicitly told about.
 */
const CORRECTION_PATTERNS: RegExp[] = [
  /\bi (already )?told you\b/i,
  /\bi said\b/i,
  /\bthat'?s not (right|correct|true|what i)\b/i,
  /\byou('re| are) (wrong|mistaken|confused)\b/i,
  /\byou (got|get) (that|it|this) wrong\b/i,
  /\bno[,.!]\s+(his|her|their|my|it'?s|its|he'?s|she'?s|that'?s)\b/i,
  /\bnot\s+\w+\s*[,.]?\s+(it'?s|its|his|her|he'?s|she'?s)\b/i,
  /\b(his|her|their) name is\b/i,
  /\bi meant\b/i,
  /\bi misspoke\b/i,
  /\blet me correct\b/i,
  /\bcorrection[,:]/i,
  /\bactually[,.]?\s+(his|her|their|my|it|he|she|that)\b/i,
];

export function detectCorrectionSignal(userMessage: string): boolean {
  return CORRECTION_PATTERNS.some(p => p.test(userMessage));
}

/**
 * Map parsed corrections onto concrete store operations against the man's
 * existing rows. Pure — unit-tested without DB or LLM.
 *
 * Matching rule: a correction updates an existing row only on an exact
 * case-insensitive key match (match_key first, then key). Anything else
 * inserts a new row. Fuzzy key matching was considered and rejected: merging
 * "brother" into "brother_name" silently is exactly the class of mistake
 * this module exists to stop.
 */
export function resolveCorrectionTargets(
  existing: MemoryRow[],
  corrections: ParsedCorrection[],
): CorrectionTarget[] {
  const targets: CorrectionTarget[] = [];
  for (const c of corrections) {
    if (!c.corrected_value || typeof c.corrected_value !== 'string') continue;
    const layer = Number.isInteger(c.layer_number) && c.layer_number >= 1 && c.layer_number <= 7
      ? c.layer_number
      : null;
    const wantedKeys = [c.match_key, c.key]
      .filter((k): k is string => !!k)
      .map(k => k.toLowerCase());
    const hit = existing.find(r => wantedKeys.includes(r.key.toLowerCase()));
    if (hit) {
      targets.push({
        action: 'update',
        id: hit.id,
        previous_value: hit.value,
        layer_number: hit.layer_number,
        key: hit.key,
        value: c.corrected_value,
      });
    } else if (layer && c.key) {
      targets.push({
        action: 'insert',
        layer_number: layer,
        key: c.key,
        value: c.corrected_value,
      });
    }
    // No layer, no key match: skip — a correction we cannot place is safer
    // dropped than stored under a guess key that duplicates the wrong value.
  }
  return targets;
}

export function buildCorrectionPrompt(memories: MemoryRow[], userMessage: string) {
  const memoryList = memories
    .map(m => `- [layer ${m.layer_number}] key="${m.key}" value="${m.value}" (confidence ${m.confidence})`)
    .join('\n');
  const system = `The user just corrected a fact the assistant previously stated about his life, or clarified an earlier statement. You are given his existing memories. Decide what the correction changes.

Return JSON with a "corrections" key containing an array of objects. Each object must have:
  - match_key: the exact "key" of the existing memory this correction replaces, or null if the corrected fact is not stored yet
  - layer_number: integer 1-7 (1 Identity, 2 Relationships, 3 Goals, 4 Challenges, 5 Decision Patterns, 6 Wins, 7 KWML Profile)
  - key: canonical short label for the corrected fact — MUST equal match_key when match_key is not null
  - corrected_value: the fact as it should now be remembered, in his words, complete enough to stand alone

RULES:
1. Only include items this message actually corrects. If it corrects nothing, return {"corrections": []}.
2. The corrected_value is the NEW truth, never the old wrong version.
3. Prefer updating an existing memory (match_key) over creating a new one whenever the old fact is visible in the list — a correction stored under a second key leaves the wrong value alive.`;
  const user = `EXISTING MEMORIES:\n${memoryList || '(none)'}\n\nHIS MESSAGE: "${userMessage}"`;
  return { system, user };
}

/** Robustly find the corrections array regardless of the JSON key GPT used. */
export function parseCorrectionResponse(content: string): ParsedCorrection[] {
  try {
    const parsed = JSON.parse(content || '{}');
    let arr: unknown[] = [];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else {
      for (const val of Object.values(parsed)) {
        if (Array.isArray(val)) { arr = val; break; }
      }
    }
    return arr
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map(c => ({
        match_key: typeof c.match_key === 'string' ? c.match_key : null,
        layer_number: typeof c.layer_number === 'number' ? c.layer_number : NaN,
        key: typeof c.key === 'string' ? c.key : '',
        corrected_value: typeof c.corrected_value === 'string' ? c.corrected_value : '',
      }))
      .filter(c => c.corrected_value.length > 0);
  } catch {
    return [];
  }
}

/**
 * Detect and persist corrections from the man's latest message.
 * Returns the number of corrections applied. Zero-cost on ordinary turns.
 */
export async function applyCorrections(
  userId: string,
  userMessage: string,
  messageId: string,
): Promise<number> {
  if (!detectCorrectionSignal(userMessage)) return 0;

  const existing = await query(
    `SELECT id, layer_number, key, value, confidence FROM memory_layers WHERE user_id = $1`,
    [userId]
  );
  const rows = existing.rows as MemoryRow[];
  if (rows.length === 0) return 0; // nothing stored yet — normal extraction covers new facts

  const { system, user } = buildCorrectionPrompt(rows, userMessage);
  const resp = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  });

  const corrections = parseCorrectionResponse(resp.choices[0].message.content || '{}');
  const targets = resolveCorrectionTargets(rows, corrections);
  if (targets.length === 0) return 0;

  const correctedAt = new Date().toISOString();
  for (const t of targets) {
    const patch = t.action === 'update'
      ? { corrected: true, previous_value: t.previous_value, corrected_at: correctedAt }
      : { corrected: true, corrected_at: correctedAt };
    if (t.action === 'update') {
      await query(
        `UPDATE memory_layers
         SET value = $1, confidence = 1.0, updated_at = NOW(), source_message_id = $2,
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = $4`,
        [t.value, messageId, JSON.stringify(patch), t.id]
      );
      console.log(`[Memory] ✏️ Correction applied: "${t.key}" was "${t.previous_value}" → "${t.value}"`);
    } else {
      await query(
        `INSERT INTO memory_layers (user_id, layer_number, layer_name, key, value, confidence, source_message_id, metadata)
         VALUES ($1, $2, $3, $4, $5, 1.0, $6, $7::jsonb)`,
        [userId, t.layer_number, LAYER_NAMES[t.layer_number], t.key, t.value, messageId, JSON.stringify(patch)]
      );
      console.log(`[Memory] ✏️ Correction stored as new memory: "${t.key}" = "${t.value}"`);
    }
  }
  return targets.length;
}
