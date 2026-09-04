/**
 * Trigger Registry — the shared deterministic rules every knowledge whisperer
 * module (listening-knowledge, embodied-man-knowledge, and any future domain
 * layer) reads before it may speak into a turn.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this registry, each module matched its own keyword list with bare
 * String.includes() and fired every area that matched. Three failure modes
 * followed, all observed in prompt-assembly measurements (2026-09-04):
 *
 *   1. Substring false positives: "that's a shame about the weather" fired the
 *      hidden-feelings area on the bare substring "shame".
 *   2. Cross-module double fire: "i'm fine" fired BOTH listening (armor
 *      reading) and embodied-man (stuck reading) — two modules injecting
 *      opposite guidance into the same turn, ~1,495 words combined.
 *   3. Unbounded injection: every matched area's full guidance plus ALL of the
 *      module's guardrails rode into the Composer prompt each firing turn.
 *
 * THE THREE TRIGGER RULES (every module enforces them through this file)
 * ----------------------------------------------------------------------
 *   1. WORD-BOUNDARY MATCHING. A token matches only as a whole word/phrase,
 *      never as a substring inside a larger word — "rage" no longer fires on
 *      "enraged". Tokens that are idiom-prone even as whole words ("shame" in
 *      "that's a shame about the weather") are removed by rule 3.
 *   2. TWO INDEPENDENT SIGNALS, OR ONE SIGNAL PLUS MINIMUM UTTERANCE LENGTH.
 *      An area is eligible only when the utterance hits at least two of its
 *      tokens, or hits one token AND is at least MIN_WORDS_SINGLE_SIGNAL
 *      words long. A bare "i don't know" (3 words) no longer fires anything.
 *   3. ONE OWNER PER TOKEN. Every contested or idiom-prone token has exactly
 *      one owner in this registry — 'listening', 'embodied_man', or 'neither'
 *      (banned). Modules validate their token lists against this registry in
 *      their tests; a token claimed by two modules, or listed as 'neither',
 *      fails the build.
 *
 * Plus TWO CAPS:
 *   - ONE AREA PER TURN per module: the eligible area with the most token
 *     hits wins; ties break by the module's declared area order. Only the
 *     winning area's guidance and guardrails are injected.
 *   - TOTAL WHISPERER INJECTION CAP: the combined landmines + context notes
 *     rendered into the Composer prompt never exceed
 *     MAX_WHISPERER_INJECT_CHARS (~1,200 tokens). Enforced at the single
 *     render point (buildEnvelopeContextSummary) so it covers every
 *     whisperer, present and future. Landmines (safety) are kept before
 *     context notes (coaching) when trimming.
 *
 * Everything here is deterministic: pure string matching, no LLM, no DB, no
 * per-turn round trips. Zero added latency beyond the regex scans the modules
 * already ran.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Trigger rule constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An area may fire on a SINGLE token hit only when the utterance is at least
 * this many words. Below it, a lone hit is treated as noise.
 */
export const MIN_WORDS_SINGLE_SIGNAL = 8;

/**
 * Hard cap on the total whisperer injection rendered into one Composer prompt:
 * landmines + context notes combined, in characters. ~4 chars/token puts this
 * at roughly 1,200 tokens per turn. buildEnvelopeContextSummary enforces it;
 * the module tests assert the worst case stays under it.
 */
export const MAX_WHISPERER_INJECT_CHARS = 4800;

// ─────────────────────────────────────────────────────────────────────────────
// Matching primitives
// ─────────────────────────────────────────────────────────────────────────────

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiled-regex cache: tokens are static module constants, compiled once. */
const boundaryCache = new Map<string, RegExp>();

/**
 * Whole-phrase match: the token must appear in `lower` (already lowercased)
 * bounded by non-word characters or string edges. "shame" matches "a shame"
 * but "rage" does not match "enraged".
 */
export function wordBoundaryIncludes(lower: string, token: string): boolean {
  let re = boundaryCache.get(token);
  if (!re) {
    re = new RegExp(`\\b${escapeRegExp(token)}\\b`);
    boundaryCache.set(token, re);
  }
  return re.test(lower);
}

/**
 * The one-area-per-turn pick, shared by every knowledge module.
 *
 * An area is ELIGIBLE when it has >= 2 token hits, or 1 hit in an utterance of
 * at least MIN_WORDS_SINGLE_SIGNAL words. Among eligible areas the one with
 * the most hits wins; ties break by `areaOrder` (the module's declared order
 * is its priority order). Returns null when nothing is eligible — the module
 * stays out of the turn entirely.
 */
export function pickTriggeredArea<T extends string>(
  lower: string,
  signals: Record<T, readonly string[]>,
  areaOrder: readonly T[],
): T | null {
  const words = countWords(lower);
  let best: T | null = null;
  let bestHits = 0;
  for (const area of areaOrder) {
    let hits = 0;
    for (const token of signals[area]) {
      if (wordBoundaryIncludes(lower, token)) hits++;
    }
    const eligible = hits >= 2 || (hits >= 1 && words >= MIN_WORDS_SINGLE_SIGNAL);
    if (eligible && hits > bestHits) {
      best = area;
      bestHits = hits;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// Token ownership
// ─────────────────────────────────────────────────────────────────────────────

export type TriggerOwner = 'listening' | 'embodied_man' | 'neither';

export interface TriggerOwnershipEntry {
  token: string;
  owner: TriggerOwner;
  reason: string;
}

/**
 * The ownership table for every token that was contested between modules or
 * banned as idiom/filler. Unlisted tokens are owned by the module that
 * declares them; a token listed here may be declared ONLY by its owner.
 * 'neither' means banned: no module may declare it.
 *
 * Resolved 2026-09-04 from the measured cross-module overlap between
 * listening-knowledge.ts and embodied-man-knowledge.ts.
 */
export const TRIGGER_OWNERSHIP: readonly TriggerOwnershipEntry[] = [
  // ── Banned as idiom/filler (owner 'neither') ─────────────────────────────
  { token: 'whatever',          owner: 'neither', reason: 'Idiom/filler: fires on casual dismissal ("whatever happens"). Also contradicts the presented+1 question cap in 82b4ec1 — Cihan\'s product decision, dropped entirely.' },
  { token: 'shame',             owner: 'neither', reason: 'Idiom: "that\'s a shame about the weather" fired hidden_feelings in measurement.' },
  { token: 'the guys',          owner: 'neither', reason: 'Casual male-company reference, not a friendship-depth signal.' },
  { token: 'my brother',        owner: 'neither', reason: 'Family mention, not men-with-men territory.' },
  { token: 'my brothers',       owner: 'neither', reason: 'Plural of the banned "my brother".' },
  { token: 'getting older',     owner: 'neither', reason: 'Idiom-prone aging phrase ("you\'re getting older" jokes).' },
  { token: 'slowing down',      owner: 'neither', reason: 'Idiom-prone: traffic, work pace, aging — cannot disambiguate deterministically.' },
  { token: 'at my age',         owner: 'neither', reason: 'Idiom-prone aging phrase.' },
  { token: 'i guess',           owner: 'neither', reason: 'Filler hedge, not a stuck signal.' },
  { token: 'it is what it is',  owner: 'neither', reason: 'Idiom; too common as conversational filler.' },
  { token: 'angry',             owner: 'neither', reason: 'Bare word too common alone. Listening owns the escalated form "i\'m so angry"; embodied-man keeps the reflective noun "anger".' },

  // ── Contested tokens, resolved to one owner ──────────────────────────────
  { token: "i'm fine",          owner: 'listening', reason: 'Armor reading (cost_of_talking) is the established, action-relevant owner. Banned from embodied-man.' },
  { token: "it's fine",         owner: 'listening', reason: 'Same armor family as "i\'m fine" — one owner.' },
  { token: 'not a big deal',    owner: 'listening', reason: 'Minimising armor — listening\'s cost_of_talking reading.' },
  { token: 'hard to explain',   owner: 'listening', reason: 'Disclosure-difficulty signal — listening\'s open_questions had it first.' },
  { token: 'furious',           owner: 'listening', reason: 'Escalated anger — listening\'s deescalation area owns the action-relevant reading.' },
  { token: "i'm so angry",      owner: 'listening', reason: 'Escalated anger — deescalation.' },
  { token: "i don't know",      owner: 'embodied_man', reason: 'The canonical stuck signal from the Embodied Man script. Listening keeps the more specific "i don\'t know how to say".' },
  { token: "i don't know how to say", owner: 'listening', reason: 'Disclosure difficulty — distinct from the bare stuck signal.' },
  { token: "don't want to talk about", owner: 'embodied_man', reason: 'Explicit boundary — consent_signal (instant topic close) is the clearer, action-relevant owner. Listening drops "don\'t want to talk about it" in the PR #18 rework.' },
  { token: "don't want to talk about it", owner: 'embodied_man', reason: 'Same boundary family — one owner (embodied_man consent_signal).' },
  { token: 'ashamed',           owner: 'embodied_man', reason: 'Hidden-feelings naming is the embodied-man play. Listening keeps the more specific "ashamed to say".' },
  { token: 'ashamed to say',    owner: 'listening', reason: 'Judgment-fear disclosure — withholding_judgment.' },
];

const ownershipByToken = new Map<string, TriggerOwner>(
  TRIGGER_OWNERSHIP.map((e) => [e.token, e.owner]),
);

/** The owner of a contested/banned token, or undefined when uncontested. */
export function tokenOwner(token: string): TriggerOwner | undefined {
  return ownershipByToken.get(token);
}

/**
 * Validation for module tests: given a module's name and every token it
 * declares, return the list of violations — tokens this module may not claim
 * (banned, or owned by the other module). Empty array means clean.
 */
export function assertTokensOwnedBy(
  module: Exclude<TriggerOwner, 'neither'>,
  tokens: readonly string[],
): string[] {
  const violations: string[] = [];
  for (const token of tokens) {
    const owner = ownershipByToken.get(token);
    if (owner !== undefined && owner !== module) {
      violations.push(
        owner === 'neither'
          ? `"${token}" is banned (owner: neither) — remove it`
          : `"${token}" is owned by ${owner} — remove it from ${module}`,
      );
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Total injection cap
// ─────────────────────────────────────────────────────────────────────────────

export interface CappedWhispererInjection {
  landmines: string[];
  context_notes: string[];
  /** True when anything was dropped — tests assert on this. */
  trimmed: boolean;
}

/**
 * Deterministic whole-item trim to MAX_WHISPERER_INJECT_CHARS. Landmines
 * (safety constraints) are kept before context notes (coaching); within each
 * list, declaration order is priority order. Trimming stops at the first item
 * that does not fit — never a mid-item truncation, so the model never sees a
 * half sentence. Under the cap the input passes through untouched
 * (byte-identical prompt assembly, same as before this cap existed).
 */
export function capWhispererInjection(
  landmines: readonly string[],
  contextNotes: readonly string[],
  maxChars: number = MAX_WHISPERER_INJECT_CHARS,
): CappedWhispererInjection {
  const keptLandmines: string[] = [];
  const keptNotes: string[] = [];
  let used = 0;
  for (const l of landmines) {
    const cost = l.length + 3; // "• " prefix + newline
    if (used + cost > maxChars) break;
    keptLandmines.push(l);
    used += cost;
  }
  for (const n of contextNotes) {
    const cost = n.length + 1; // newline join
    if (used + cost > maxChars) break;
    keptNotes.push(n);
    used += cost;
  }
  return {
    landmines: keptLandmines,
    context_notes: keptNotes,
    trimmed: keptLandmines.length < landmines.length || keptNotes.length < contextNotes.length,
  };
}
