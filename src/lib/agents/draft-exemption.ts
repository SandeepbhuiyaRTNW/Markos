/**
 * Draft Exemption — Safe Communication Assistance, Step 5.
 *
 * WHY THIS EXISTS
 *   When Marcus helps a man draft a message to someone else (help_communicate),
 *   the produced text is a QUOTED DRAFT — it is deliberately NOT in Marcus's own
 *   voice. The composer's post-generation VOICE gates assume everything is
 *   Marcus speaking, so they would mangle a draft:
 *     • vocab_fidelity   → re-rolls because a draft won't echo the man's exact words
 *     • vocative_principle→ strips names the draft may legitimately need
 *     • forbidden_phrase  → trips on ordinary message language
 *     • trajectory_dedup  → re-rolls a draft as "repetitive"
 *     • fantasy_identity  → flags legitimate "imagine us a year from now" phrasing
 *     • boundary          → a persona/voice gate (keeps Marcus in role); a draft
 *                            is intentionally not in his role
 *   So a draft must be EXEMPT from the voice gates.
 *
 * THE DANGEROUS FAILURE MODE (this is the whole point of HARD STOP 2)
 *   "Exempt from the voice gates" must NEVER become "exempt from the harm check."
 *   The voice gates police STYLE. The harm layers police SAFETY. A draft skips
 *   the former; it can NEVER skip the latter. If the exemption ever leaked into
 *   the harm layers, a harmful draft would sail straight to the user — the exact
 *   thing the audit warned about (nothing inspects Marcus's OUTPUT for harm).
 *
 * The types below make that structural: VOICE_GATES is the ONLY exempt set, the
 * harm layers are a DISJOINT set, and runHarmLayers() is called unconditionally
 * on the draft regardless of any exemption.
 */

import { checkHarm } from '../sentinels/harm-gate';
import { judgeHarm, type JudgeFn } from '../sentinels/harm-judge';

/**
 * The composer's post-generation VOICE gates, in pipeline order. A draft in a
 * help_communicate turn bypasses THESE (and only these). Mirrors
 * orchestrator-v2-composer.ts: boundary → trajectory → fantasy → vocab →
 * forbidden → vocative (always-last).
 */
export const VOICE_GATES = [
  'boundary',           // persona/voice boundary sentinel — keeps Marcus in role (NOT harm)
  'trajectory_dedup',
  'fantasy_identity',
  'vocab_fidelity',
  'forbidden_phrase',
  'vocative_principle',
] as const;
export type VoiceGate = typeof VOICE_GATES[number];

/**
 * The SAFETY layers. Disjoint from VOICE_GATES by construction. A draft is
 * NEVER exempt from these — harmLayersAreNeverExempt() proves the disjointness
 * and the HARD STOP 2 test asserts it.
 */
export const HARM_LAYERS = ['harm_gate_regex', 'harm_judge'] as const;
export type HarmLayer = typeof HARM_LAYERS[number];

const VOICE_GATE_SET: Set<string> = new Set(VOICE_GATES);

/** True ONLY for a voice gate. Harm-layer names (or anything else) → false. */
export function isDraftExempt(gate: string): boolean {
  return VOICE_GATE_SET.has(gate);
}

/** Invariant: no harm layer is ever in the exempt (voice) set. */
export function harmLayersAreNeverExempt(): boolean {
  return HARM_LAYERS.every(h => !VOICE_GATE_SET.has(h));
}

export interface HarmLayersResult {
  blocked: boolean;
  layer: 'regex' | 'judge' | null; // which layer blocked (null if clean)
  categories: string[];            // regex categories, or the judge category
  reason: string;                  // short rationale for logging
}

/**
 * Run BOTH harm layers over a help_communicate turn. This is called on the
 * request AND the draft, UNCONDITIONALLY — the voice-gate exemption has no effect
 * here. Fail-closed: the judge itself returns harmful on any error/timeout.
 *
 *   Layer 1 (regex, cheap): checkHarm on request AND draft.
 *   Layer 2 (judge, semantic): only if layer 1 is clean.
 * Either layer blocking → refuse to surface the draft.
 *
 * The judge is injectable so tests can run deterministically without an API call
 * and so the caller can swap implementations; it defaults to the real judgeHarm.
 */
export async function runHarmLayers(
  input: { request: string; draft?: string },
  opts?: { judge?: JudgeFn },
): Promise<HarmLayersResult> {
  const judge = opts?.judge ?? judgeHarm;

  // ── Layer 1: regex on request AND draft ──
  const reqHarm = checkHarm(input.request || '');
  const draftHarm = input.draft ? checkHarm(input.draft) : { harmful: false, categories: [], matched: [] };
  if (reqHarm.harmful || draftHarm.harmful) {
    const categories = [...new Set([...reqHarm.categories, ...draftHarm.categories])];
    return {
      blocked: true,
      layer: 'regex',
      categories,
      reason: `lexical harm (${categories.join(',')})`,
    };
  }

  // ── Layer 2: semantic judge (only reached when regex is clean) ──
  const verdict = await judge({ request: input.request, draft: input.draft });
  if (verdict.harmful) {
    return {
      blocked: true,
      layer: 'judge',
      categories: verdict.category ? [verdict.category] : [],
      reason: verdict.reason || 'semantic harm',
    };
  }

  return { blocked: false, layer: null, categories: [], reason: '' };
}
