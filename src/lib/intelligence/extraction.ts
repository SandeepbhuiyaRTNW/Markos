/**
 * Conversation Intelligence extraction — the single batched gpt-4o-mini call,
 * plus the gate that decides whether it is worth making at all.
 */

import OpenAI from 'openai';
import type { CIExtraction, ExistingLoop } from './types';
import type { LoopSignal } from './loop-signals';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

// ─── Gate constants ───
export const CI_MIN_DEPTH = 3;          // emotional depth (1-5) that earns a full pass
export const CI_LLM_EVERY_N_TURNS = 4;  // periodic pass even on a quiet stretch

/**
 * Decide whether to spend a gpt-4o-mini call this turn. The arc append and the
 * regex loop-signal scan already ran (both free); this only gates the LLM.
 *
 * Fires when the turn is EARNED:
 *   - emotional depth >= CI_MIN_DEPTH (something real is happening), OR
 *   - a regex loop-signal hit (he named an unresolved thread), OR
 *   - every CI_LLM_EVERY_N_TURNS turns (a periodic checkpoint).
 *
 * A throwaway turn ("thanks, that helps") hits none of these and costs ZERO tokens.
 */
export function shouldRunCIExtraction(params: {
  depth: number;
  loopSignalCount: number;
  turnNumber: number;
}): boolean {
  return (
    params.depth >= CI_MIN_DEPTH ||
    params.loopSignalCount > 0 ||
    (params.turnNumber > 0 && params.turnNumber % CI_LLM_EVERY_N_TURNS === 0)
  );
}

const SYSTEM_PROMPT = `You analyze ONE exchange from an ongoing voice conversation between a man and Marcus (a Stoic AI companion). Another system already extracts isolated facts — do NOT do that. You capture the conversation as an EVENT in his life: who is involved, what is unresolved, what to follow up on, and moments where he found new language for a feeling.

Return JSON with EXACTLY these keys:
{
  "headline": "one sentence naming what this conversation is really about",
  "people": [{"name": "...", "relationship": "brother|wife|boss|friend|...", "sentiment": "conflicted|warm|resentful|...", "note": "specific thing said or done, in his words"}],
  "vocabulary_moments": [{"from": "the vague word he started with", "to": "the more precise feeling he reached", "quote": "his exact words"}],
  "what_changed": "what is different in how he talks about this vs usual — empty string if unknown",
  "new_open_loops": [{"summary": "an unresolved thread in his words (a decision unmade, a conversation unhad)", "salience": 0.0, "people": ["brother"]}],
  "resolved_open_loops": [{"id": "<id of an existing loop below he resolved THIS turn>", "resolution": "what he decided or did"}],
  "referenced_open_loops": ["<id of an existing loop that came up again but is still open>"],
  "follow_ups": [{"prompt": "a concrete thing Marcus should ask next time, imperative", "trigger": "next_session", "value": 0.0}]
}

RULES:
- Use HIS words. Do not sanitize, abstract, or clinicalize.
- Not every turn has a loop, a person, or a vocabulary moment. Empty arrays are correct and expected — prefer them over inventing.
- Only open a loop for something genuinely unresolved and worth returning to.
- Only mark a loop resolved if he clearly resolved it THIS turn. Use ONLY ids from the existing loops provided.
- referenced_open_loops: existing loop ids he touched again but did not resolve.
- follow_ups must be specific enough to act on cold ("Ask whether he called his brother"), never generic ("check in on his feelings").
- salience and value are 0.0-1.0.`;

function buildUserPayload(input: ExtractionInput): string {
  const loops = input.existingLoops.length
    ? input.existingLoops.map(l => `${l.id} — ${l.summary}`).join('\n')
    : 'none';
  const signals = input.loopSignals.length
    ? input.loopSignals.map(s => s.label).join(', ')
    : 'none';
  return `Detected emotion: ${input.emotion} | Arena: ${input.arena || 'unknown'} | Depth: ${input.depth}/5
Regex loop-signals this turn: ${signals}

Existing OPEN loops for this man (id — summary):
${loops}

He said: "${input.userMessage}"
Marcus responded: "${input.marcusResponse}"`;
}

function asArray<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function asString(v: unknown): string { return typeof v === 'string' ? v : ''; }

const CI_KEYS = [
  'headline', 'what_changed', 'people', 'vocabulary_moments',
  'new_open_loops', 'resolved_open_loops', 'referenced_open_loops', 'follow_ups',
];

/**
 * Find the object that actually holds the CI fields. Mirrors extractMemories'
 * defensiveness: never assume the expected keys are at the top level. If the
 * model wrapped the payload under an unexpected key (e.g. {"result": {...}}),
 * descend one level to find the object that has CI keys. If nothing looks like a
 * CI object, return {} so normalization degrades to "captured nothing this turn".
 */
function unwrapCIObject(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;
  const hasCIKeys = (o: Record<string, unknown>) => CI_KEYS.some(k => k in o);
  if (hasCIKeys(obj)) return obj;
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && hasCIKeys(v as Record<string, unknown>)) {
      return v as Record<string, unknown>;
    }
  }
  return {};
}

/**
 * Normalize a parsed model response into a CIExtraction. Every field is optional
 * and degrades to empty ([] / '') — a malformed or renamed response yields an
 * empty extraction ("captured nothing"), never a throw.
 */
function normalizeExtraction(parsed: unknown): CIExtraction {
  const obj = unwrapCIObject(parsed);
  return {
    headline: asString(obj.headline),
    people: asArray(obj.people),
    vocabulary_moments: asArray(obj.vocabulary_moments),
    what_changed: asString(obj.what_changed),
    new_open_loops: asArray(obj.new_open_loops),
    resolved_open_loops: asArray(obj.resolved_open_loops),
    referenced_open_loops: asArray<string>(obj.referenced_open_loops).filter(x => typeof x === 'string'),
    follow_ups: asArray(obj.follow_ups),
  };
}

export interface ExtractionInput {
  userMessage: string;
  marcusResponse: string;
  emotion: string;
  arena: string | null;
  depth: number;
  existingLoops: ExistingLoop[];
  loopSignals: LoopSignal[];
}

/** Run the batched CI extraction. Returns null on any failure (best-effort). */
export async function extractConversationIntelligence(input: ExtractionInput): Promise<CIExtraction | null> {
  try {
    const resp = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPayload(input) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });
    const raw = resp.choices[0].message.content || '{}';
    return normalizeExtraction(JSON.parse(raw));
  } catch (err) {
    console.warn('[CI] extraction failed:', err);
    return null;
  }
}
