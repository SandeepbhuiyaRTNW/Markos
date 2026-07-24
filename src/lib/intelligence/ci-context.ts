/**
 * CI Context read-side wiring — feature/ci-context-readside.
 *
 * This is WIRING + PROMPT-CRAFT, not a new system. The read function already
 * exists: getConversationIntelligenceContext (surfacing.ts) enforces the
 * surfacing BUDGET (≤ 1 open loop + 1 follow-up) and STALENESS (it queries
 * status='open', so dormant/resolved loops are excluded; follow-ups are gated on
 * pending + due). This module adds two things:
 *   1. the FLAG (CI_CONTEXT_ENABLED, default OFF), and
 *   2. the PROMPT-CRAFT frame that makes Marcus reference a remembered thread
 *      like a friend who remembers — NOT like a system reading a record.
 *
 * FLAG OFF (default): getCICallbackBlock is never called (the orchestrator gates
 * it), mergeMemoryContext collapses to the exact prior expression, and nothing
 * reaches the prompt — live behavior is byte-identical to today.
 *
 * NOT DONE HERE (noted follow-ups): turn-RELEVANCE matching (retrieval is
 * salience/value-ranked, not matched to the current utterance — relevance is
 * enforced instructionally below); programmatic dedup vs the memory_layers facts
 * (handled instructionally); correct/forget UI.
 */

import { getConversationIntelligenceContext } from './surfacing';

/** CI_CONTEXT_ENABLED gate. Default OFF. Same convention as KI/COMM_ASSIST. */
export function ciContextEnabled(): boolean {
  const v = process.env.CI_CONTEXT_ENABLED;
  return v === 'true' || v === '1';
}

// ─── The prompt-craft frame (the part that matters most) ────────────────────
const CI_CALLBACK_HEADER =
`## SOMETHING YOU REMEMBER ABOUT HIM
You remember this from before — the way a friend remembers, not a system reading a file. Reference it ONLY if it fits what he is actually saying right now.`;

const CI_CALLBACK_INSTRUCTIONS =
`HOW TO USE THIS (read carefully):
- Reference AT MOST ONE remembered thing, only in your opening, woven in naturally. Never stack them.
- Say it the way a friend would: "Last time you were dreading telling your kids — how'd that go?" or "You said things were rough with your brother — where's that at now?"
- NEVER speak like a record. Banned: "Based on our previous conversation…", "According to my records…", "you have 1 open loop…", or listing what you remember. If it sounds like a database, it is wrong.
- If today's topic is unrelated, or a callback would feel forced or interrogating, DO NOT force it — let it go and be present with what he brought today. Forced continuity is worse than none.
- This is for continuing a THREAD, not repeating facts. Do not restate something already stated elsewhere in your context.`;

/**
 * Pure render: wrap raw surfacing output in the prompt-craft frame.
 * Empty/whitespace input → '' (no header, no empty block).
 */
export function renderCICallback(rawContext: string | null | undefined): string {
  const raw = (rawContext || '').trim();
  if (!raw) return '';
  return `${CI_CALLBACK_HEADER}\n\n${raw}\n\n${CI_CALLBACK_INSTRUCTIONS}`;
}

/**
 * Merge the existing memory_layers context (base) with the CI callback block.
 * When there is no CI block, returns EXACTLY the composer's prior expression
 * (`base || undefined`) — so flag-off is byte-identical. When present, appends it
 * as a distinct block AFTER the facts (both coexist; CI never replaces memory).
 */
export function mergeMemoryContext(
  base: string | null | undefined,
  ci: string | null | undefined,
): string | undefined {
  const b = base || '';
  const c = (ci || '').trim();
  if (!c) return b || undefined; // no CI → identical to `memory_context || undefined`
  return b ? `${b}\n\n${c}` : c;
}

/**
 * Fetch + wrap the CI callback block for a user. '' when nothing to surface.
 *
 * SIDE EFFECT (inherited from getConversationIntelligenceContext): the surfaced
 * follow-up is marked 'surfaced' so it is not re-offered next turn — the budget
 * is consumed on RETRIEVAL, not on use. The orchestrator therefore calls this
 * ONLY on turns that reach the composer (after the crisis/frame-refusal early
 * returns), so a follow-up is never consumed on a turn Marcus never composes.
 */
export async function getCICallbackBlock(userId: string): Promise<string> {
  const raw = await getConversationIntelligenceContext(userId);
  return renderCICallback(raw);
}
