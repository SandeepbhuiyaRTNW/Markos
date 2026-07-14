/**
 * Knowledge Intelligence — Tier 2.6 (pure, deterministic, no LLM, no DB).
 *
 * Decides WHICH knowledge sources the composer should use this turn, so Marcus
 * stops loading every book/framework every turn (latency + over-psychologizing).
 * Founder focus: divorce and grief first. EXCLUSION-FIRST — the exclude filter is
 * the guaranteed win (it works off the main corpus's domain tags regardless of
 * whether the divorce/grief books are present); toward-scoping is a bonus-if-
 * present that degrades to empty-retrieval → prompt/whisperer fallback.
 *
 * This layer EMITS INTENT ONLY. It never queries a database; the retriever
 * applies the plan later. So its output is a pure function of (env, decision)
 * and is byte-identical regardless of DB state.
 *
 * FEATURE-FLAGGED: KI_ENABLED (default OFF) → passthrough plan ≡ today's behavior
 * (search everything). UNWIRED: nothing in the composer calls this yet; the
 * retrieveWisdom excludeDomains param + composer wiring are the cutover PR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE LADDER — evaluated top-to-bottom, FIRST MATCH WINS. The ORDER IS THE
 * SPEC. Exclusion-first; every rung's exclude list is DB-state-independent.
 *
 *  1. crisis          crisis.level != 'none' or move crisis_protocol
 *                     → safetyOnly: wisdom off, questions off, whisperer off
 *  2. divorce_shock   move-selector emitted too_early (only set on early shock)
 *                     → exclude the full psych corpus, scope questions via
 *                       whisperer='divorce' (NOT arena — divorce Qs are tagged
 *                       arena='relationship'), toward=[divorce,grief]
 *  3. grief           arena grief >= 0.3 OR silence 'grief'
 *                     → exclude full psych corpus, questions arena='grief' AND
 *                       whisperer='grief', toward=[grief]
 *  4. children        move-selector child_centered_frame
 *                     → exclude deep psych (shadow/kwml/meaning), questions via
 *                       whisperer='divorce' (co-parenting lives there), toward=[]
 *                       (NO fatherhood corpus exists — whisperer + prompt only)
 *  5. practical       move give_practical_advice
 *                     → exclude deep psych + perma, questions off
 *  6a. reflect_high_intensity  (reflect_only|stay_present) AND depth >= 4
 *                     → wisdom off (raw — no heavy frameworks), whisperer off
 *  6b. reflect_light  reflect_only | stay_present  (NOT high-intensity; a plain
 *                     reflect in e.g. a meaning/purpose talk)
 *                     → wisdom ALLOWED (full), questions off (reflect doesn't ask)
 *  7. default         (total) → full knowledge (≡ passthrough, but flag was on)
 *
 * Refinement note: rung 6 must NOT over-fire. Early-divorce-shock reflect turns
 * are caught at rung 2 (heavy wisdom excluded there); high-intensity reflects at
 * 6a; a plain reflect (meaning/purpose) reaches 6b with wisdom allowed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { StateEnvelope } from '../agents/state-envelope';

/**
 * Minimal structural subset of the move-selector's MoveDecision that KI reads.
 * This branch is independent of feature/conversation-move-selector, so KI does
 * NOT import that module; the real MoveDecision satisfies this shape at cutover.
 */
export interface MoveDecisionInput {
  move: string;
  too_early_to_address: string[];
  child_centered_frame: boolean;
}

export interface KnowledgePlan {
  safetyOnly: boolean;
  wisdom: {
    enabled: boolean;
    excludeDomains: string[];   // THE guaranteed win — applied regardless of DB state
    towardDomains: string[];    // soft preference, bonus-if-present
  };
  questions: {
    enabled: boolean;
    whispererScope: string[] | null;  // divorce routes here (Qs tagged whisperer='divorce')
    arenaScope: string[] | null;      // grief routes here (Qs tagged arena='grief')
  };
  includeWhispererOutput: boolean;
  rule: string;
  rationale: string;
}

// ─── Verified domain tags (from ingest-books.ts metadata->>'domain') ───
// The full main corpus minus divorce/grief — the exclude-set for a divorce/grief
// turn. This is the guaranteed win: it holds even if the divorce/grief books are
// absent from the DB.
export const FULL_PSYCH_EXCLUDE = ['stoic', 'stoic_practice', 'kwml', 'masculinity', 'shadow', 'perma', 'meaning'];
// Deep-psychology subset — excluded when we want to stay concrete (children).
export const DEEP_PSYCH_EXCLUDE = ['shadow', 'kwml', 'meaning'];
// Practical asks: no deep psychology, no flourishing frameworks.
export const PRACTICAL_EXCLUDE = ['shadow', 'kwml', 'meaning', 'perma'];

const HIGH_INTENSITY_DEPTH = 4;
const GRIEF_ARENA_MIN = 0.3;

// ─── Signal readers (reuse envelope fields; never query anything) ───
function arenaWeight(env: StateEnvelope, key: string): number { return env.assessment.arena?.weights?.[key] || 0; }
function depthOf(env: StateEnvelope): number { return env.sentinels.listener_stack?.depth_level || 1; }
function isGrief(env: StateEnvelope): boolean {
  return arenaWeight(env, 'grief') >= GRIEF_ARENA_MIN || env.assessment.silence_type?.label === 'grief';
}

function kiEnabled(): boolean {
  const v = process.env.KI_ENABLED;
  return v === 'true' || v === '1';
}

type PlanBody = Omit<KnowledgePlan, 'rule' | 'rationale'>;

interface KIRule {
  name: string;
  predicate: (env: StateEnvelope, decision: MoveDecisionInput) => boolean;
  plan: PlanBody;
}

const RULES: KIRule[] = [
  { name: 'crisis',
    predicate: (e, d) => e.sentinels.crisis.level !== 'none' || d.move === 'crisis_protocol',
    plan: {
      safetyOnly: true,
      wisdom: { enabled: false, excludeDomains: [], towardDomains: [] },
      questions: { enabled: false, whispererScope: null, arenaScope: null },
      includeWhispererOutput: false,
    } },

  { name: 'divorce_shock',
    // too_early is populated ONLY by the move-selector's early_divorce_shock rung.
    predicate: (_e, d) => d.too_early_to_address.length > 0,
    plan: {
      safetyOnly: false,
      wisdom: { enabled: true, excludeDomains: FULL_PSYCH_EXCLUDE, towardDomains: ['divorce', 'grief'] },
      questions: { enabled: true, whispererScope: ['divorce'], arenaScope: null },
      includeWhispererOutput: true,
    } },

  { name: 'grief',
    predicate: (e) => isGrief(e),
    plan: {
      safetyOnly: false,
      wisdom: { enabled: true, excludeDomains: FULL_PSYCH_EXCLUDE, towardDomains: ['grief'] },
      questions: { enabled: true, whispererScope: ['grief'], arenaScope: ['grief'] },
      includeWhispererOutput: true,
    } },

  { name: 'children',
    predicate: (_e, d) => d.child_centered_frame === true,
    plan: {
      safetyOnly: false,
      wisdom: { enabled: true, excludeDomains: DEEP_PSYCH_EXCLUDE, towardDomains: [] },
      questions: { enabled: true, whispererScope: ['divorce'], arenaScope: null },
      includeWhispererOutput: true,
    } },

  { name: 'practical',
    predicate: (_e, d) => d.move === 'give_practical_advice',
    plan: {
      safetyOnly: false,
      wisdom: { enabled: true, excludeDomains: PRACTICAL_EXCLUDE, towardDomains: [] },
      questions: { enabled: false, whispererScope: null, arenaScope: null },
      includeWhispererOutput: true,
    } },

  { name: 'reflect_high_intensity',
    predicate: (e, d) => (d.move === 'reflect_only' || d.move === 'stay_present') && depthOf(e) >= HIGH_INTENSITY_DEPTH,
    plan: {
      safetyOnly: false,
      wisdom: { enabled: false, excludeDomains: [], towardDomains: [] },
      questions: { enabled: false, whispererScope: null, arenaScope: null },
      includeWhispererOutput: false,
    } },

  { name: 'reflect_light',
    predicate: (_e, d) => d.move === 'reflect_only' || d.move === 'stay_present',
    plan: {
      safetyOnly: false,
      wisdom: { enabled: true, excludeDomains: [], towardDomains: [] },
      questions: { enabled: false, whispererScope: null, arenaScope: null },
      includeWhispererOutput: true,
    } },

  { name: 'default',
    predicate: () => true,
    plan: {
      safetyOnly: false,
      wisdom: { enabled: true, excludeDomains: [], towardDomains: [] },
      questions: { enabled: true, whispererScope: null, arenaScope: null },
      includeWhispererOutput: true,
    } },
];

const RULE_RATIONALE: Record<string, string> = {
  crisis: 'Crisis — safety only; no wisdom, questions, or whisperer framing.',
  divorce_shock: 'Early divorce shock — suppress the whole psych corpus; toward divorce/grief if present.',
  grief: 'Grief — suppress the psych corpus; toward the grief corpus and grief questions.',
  children: 'Child-centered — stay concrete (no deep psych); co-parenting questions via the divorce whisperer.',
  practical: 'Practical ask — no deep psychology; do not push probing questions.',
  reflect_high_intensity: 'Raw depth — no heavy frameworks; sit with him.',
  reflect_light: 'Plain reflect/present — wisdom allowed; do not push questions.',
  default: 'No scoping rule matched — full knowledge.',
  passthrough: 'KI disabled (KI_ENABLED off) — search everything (today\'s behavior).',
};

function clonePlan(body: PlanBody, name: string): KnowledgePlan {
  return {
    safetyOnly: body.safetyOnly,
    wisdom: {
      enabled: body.wisdom.enabled,
      excludeDomains: [...body.wisdom.excludeDomains],
      towardDomains: [...body.wisdom.towardDomains],
    },
    questions: {
      enabled: body.questions.enabled,
      whispererScope: body.questions.whispererScope ? [...body.questions.whispererScope] : null,
      arenaScope: body.questions.arenaScope ? [...body.questions.arenaScope] : null,
    },
    includeWhispererOutput: body.includeWhispererOutput,
    rule: name,
    rationale: RULE_RATIONALE[name] ?? name,
  };
}

const PASSTHROUGH_BODY: PlanBody = {
  safetyOnly: false,
  wisdom: { enabled: true, excludeDomains: [], towardDomains: [] },
  questions: { enabled: true, whispererScope: null, arenaScope: null },
  includeWhispererOutput: true,
};

/**
 * Decide the knowledge plan for this turn. Pure and deterministic; emits intent
 * only. `opts.enabled` overrides the KI_ENABLED env flag (used by tests).
 */
export function selectKnowledgePlan(
  env: StateEnvelope,
  decision: MoveDecisionInput,
  opts?: { enabled?: boolean },
): KnowledgePlan {
  const enabled = opts?.enabled ?? kiEnabled();
  if (!enabled) return clonePlan(PASSTHROUGH_BODY, 'passthrough');

  for (const rule of RULES) {
    if (rule.predicate(env, decision)) return clonePlan(rule.plan, rule.name);
  }
  // Unreachable: 'default' is total. Kept for exhaustiveness.
  return clonePlan(RULES[RULES.length - 1].plan, 'default');
}

/** Exposed for tests/observability: the ladder rule names in order. */
export const KI_RULE_ORDER = RULES.map(r => r.name);
