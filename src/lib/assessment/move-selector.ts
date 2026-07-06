/**
 * Conversation Move Selector — Tier 2.5 (pure, deterministic, no LLM).
 *
 * Founder principle: "the right question in the wrong context is still the wrong
 * question." Before the composer generates, commit to exactly ONE conversational
 * move plus guardrails. This layer does NOT write the user-facing response — it
 * returns structured guidance (a MoveDecision) the composer will later consume.
 *
 * It RE-READS the already-populated envelope (arena, listener stack, trust,
 * phase, silence type, whisperer landmines, crisis routing, pathway candidates,
 * style preferences) and the conversation-state engine. It derives nothing that
 * another tier already computed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE LADDER — evaluated top-to-bottom, FIRST MATCH WINS, returns ONE move.
 * The ORDER IS THE SPEC. Read it as a list; do not bury it in nested if/else.
 *
 *  1. crisis_pass_through          crisis.level !== 'none'          -> crisis_protocol
 *  2. advice_ask_overrides_just_listen  style"just listen" + a CURRENT direct
 *                                  advice ask -> give_practical_advice
 *                                  [DELIBERATE PRODUCT DECISION: an explicit
 *                                   in-the-moment ask beats a standing
 *                                   no-questions preference — he changed his mind]
 *  3. honor_just_listen            standing no-questions pref (and no advice ask)
 *                                  -> stay_present
 *  4. early_divorce_shock          divorce arena + (session<=3 OR unsilenced)
 *                                  -> reflect_only, too_early = [identity_rebuild,
 *                                     financial_strategy, dating, reconciliation]
 *  5. children_child_centered      children involved + divorce arena
 *                                  -> make_observation (child-centered frame)
 *  6. pushback_no_question         pushbackCount >= 2 -> reflect_only (no question,
 *                                  no advice — stop pushing)
 *  7. explicit_practical_advice    direct advice ask (no style pref) ->
 *                                  give_practical_advice
 *  8. ask_loss_naming              grief-silence + depth>=3 + phase!=unsilenced
 *                                  + affective trust >= rapport threshold (an
 *                                  intimate probe — phase alone must NOT unlock it)
 *                                  -> ask_loss_naming_question
 *  9. ask_grounding               avoidance-silence + depth<=3 (side door)
 *                                  -> ask_grounding_question
 * 10. default_reflect_deep         depth >= 3 -> reflect_only
 * 11. default_observe             (total) -> make_observation
 *
 * Rules 8–9 are a safe refinement of the depth-default tail so the selector can
 * choose the RIGHT question, not just avoid the wrong one. Everything above them
 * (all the hard gates) is in the exact order specified.
 *
 * CROSS-CUTTING (applied to whatever move wins, not ladder positions):
 *   - child_centered_frame: true whenever children are involved (any move).
 *   - refer_human_support: surfaced from the Pathway Router's candidates
 *     (reuse, not a second detector); warranted only when a candidate is 'now'.
 *
 * NOT WIRED: selectMove is pure and returns craft_form (move -> craft form), but
 * does NOT write it back onto env.craft_directives or touch the composer. That
 * reconciliation is the wiring PR.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  StateEnvelope, CraftDirectives, PathwayCandidate,
} from '../agents/state-envelope';
import type { ConversationState } from '../agents/conversation-state';

export type ConversationMove =
  | 'crisis_protocol'
  | 'stay_present'
  | 'reflect_only'
  | 'make_observation'
  | 'ask_grounding_question'
  | 'ask_loss_naming_question'
  | 'give_practical_advice'
  | 'refer_to_human_support';

type CraftForm = CraftDirectives['form']; // 'question' | 'statement' | 'reflection' | 'challenge' | 'presence'

export interface ReferralSuggestion {
  warranted: boolean;                       // true only when a pathway candidate is ready 'now'
  target: string | null;                    // e.g. 'therapy', 'mens_circle', 'veterans_support'
  when: 'now' | 'later' | 'not_yet' | null;
}

export interface MoveDecision {
  move: ConversationMove;
  rule: string;                  // which ladder rule fired (observability + tests)
  ask_question: boolean;         // true only for the ask_* moves
  craft_form: CraftForm;         // move -> craft form (RETURNED, not yet applied)
  too_early_to_address: string[];
  child_centered_frame: boolean;
  refer_human_support: ReferralSuggestion;
  rationale: string;
}

// ─── Move -> craft form (returned in the decision; wiring PR applies it) ───
export const MOVE_TO_FORM: Record<ConversationMove, CraftForm> = {
  crisis_protocol: 'statement',
  stay_present: 'presence',
  reflect_only: 'reflection',
  make_observation: 'statement',
  ask_grounding_question: 'question',
  ask_loss_naming_question: 'question',
  give_practical_advice: 'statement',
  refer_to_human_support: 'statement',
};

const ASK_MOVES = new Set<ConversationMove>(['ask_grounding_question', 'ask_loss_naming_question']);

export const DIVORCE_SHOCK_TOO_EARLY = ['identity_rebuild', 'financial_strategy', 'dating', 'reconciliation'];

// Affective trust required before Marcus invites an INTIMATE probe (naming a
// loss). Above the 0.2 new-user default and the ~0.4 unleashed-entry band:
// genuine emotional rapport, not merely "not brand new". mapPhase can mark a
// deep first message 'unleashed' while trust is still low, so phase alone must
// NOT unlock a probing move — the trust gate is the real guard.
export const RAPPORT_MIN_AFFECTIVE_TRUST = 0.5;

// Stored preference KEYS (written by extractMemories, memory-manager.ts) that
// mean "do not end with / ask questions". We match the STABLE key, not the prose
// value, so a later reword of the value can never silently stop the preference
// from being honored. style_no_advice is intentionally excluded (it is about
// advice, not questions).
const NO_QUESTION_PREF_KEYS = [
  'style_no_ending_questions',
  'style_no_questions',
  'style_just_listen',
  'style_presence',
];

// ─── Signal readers (all reuse envelope fields; derive nothing new) ───

function depthOf(env: StateEnvelope): number { return env.sentinels.listener_stack?.depth_level || 1; }
function sessionOf(env: StateEnvelope): number { return env.sentinels.memory.session_count || 0; }
function arenaWeight(env: StateEnvelope, key: string): number { return env.assessment.arena?.weights?.[key] || 0; }

const ADVICE_ASK_RE = /\b(what should i do|what do i do|how do i|how should i|should i\b|what would you do|give me advice|help me (figure|decide|with)|tell me what to do)\b/i;
function isDirectAdviceAsk(env: StateEnvelope, cs: ConversationState | null): boolean {
  return cs?.intent === 'seeking_direction' || ADVICE_ASK_RE.test(env.utterance);
}

// Fallback ONLY for an in-utterance request made THIS turn, before extractMemories
// has stored it as a preference (e.g. "just listen", "stop asking questions").
const NO_Q_PREF_RE = /(stop\s+(asking|ending)|without\s+asking\s+questions|just\s+listen|just\s+be\s+present|not\s+probing|don'?t\s+(ask|end|give))/i;

function hasNoQuestionPref(env: StateEnvelope): boolean {
  // Stored preference: honor via the carried KEY (robust to value rewording).
  // getStylePreferences now prefixes each line with its key, e.g.
  // "- [style_no_ending_questions] ...".
  const prefs = env.sentinels.memory.style_preferences;
  if (prefs && NO_QUESTION_PREF_KEYS.some(k => prefs.includes(k))) return true;
  // In-utterance request this turn (not yet stored as a preference).
  return NO_Q_PREF_RE.test(env.utterance);
}

function divorceShock(env: StateEnvelope): boolean {
  return arenaWeight(env, 'divorce') >= 0.5 && (sessionOf(env) <= 3 || env.assessment.phase.label === 'unsilenced');
}

const CHILDREN_RE = /\b(kid|kids|child|children|son|daughter|custody|co-?parent)\b/i;
function childrenInvolved(env: StateEnvelope): boolean {
  return CHILDREN_RE.test(env.utterance) || arenaWeight(env, 'fatherhood') >= 0.5;
}

function pushbackOf(cs: ConversationState | null): number { return cs?.pushbackCount ?? 0; }

// ─── The ordered rule ladder (the spec) ───

interface Rule {
  name: string;
  predicate: (env: StateEnvelope, cs: ConversationState | null) => boolean;
  move: ConversationMove;
  too_early?: string[];
  sets?: { child_centered?: boolean };
}

const RULES: Rule[] = [
  { name: 'crisis_pass_through',
    predicate: (e) => e.sentinels.crisis.level !== 'none',
    move: 'crisis_protocol' },

  { name: 'advice_ask_overrides_just_listen',
    predicate: (e, c) => hasNoQuestionPref(e) && isDirectAdviceAsk(e, c),
    move: 'give_practical_advice' },

  { name: 'honor_just_listen',
    predicate: (e) => hasNoQuestionPref(e),
    move: 'stay_present' },

  { name: 'early_divorce_shock',
    predicate: (e) => divorceShock(e),
    move: 'reflect_only',
    too_early: DIVORCE_SHOCK_TOO_EARLY },

  { name: 'children_child_centered',
    predicate: (e) => childrenInvolved(e) && arenaWeight(e, 'divorce') >= 0.3,
    move: 'make_observation',
    sets: { child_centered: true } },

  { name: 'pushback_no_question',
    predicate: (_e, c) => pushbackOf(c) >= 2,
    move: 'reflect_only' },

  { name: 'explicit_practical_advice',
    predicate: (e, c) => isDirectAdviceAsk(e, c),
    move: 'give_practical_advice' },

  { name: 'ask_loss_naming',
    // Intimate probe: requires grief-silence, real depth, past the opening
    // phase, AND genuine affective trust. The trust gate is the real guard —
    // phase alone can be 'unleashed' on a deep first message while trust is low.
    predicate: (e) => e.assessment.silence_type?.label === 'grief'
      && depthOf(e) >= 3
      && e.assessment.phase.label !== 'unsilenced'
      && e.assessment.trust.affective >= RAPPORT_MIN_AFFECTIVE_TRUST,
    move: 'ask_loss_naming_question' },

  { name: 'ask_grounding',
    predicate: (e) => e.assessment.silence_type?.label === 'avoidance' && depthOf(e) <= 3,
    move: 'ask_grounding_question' },

  { name: 'default_reflect_deep',
    predicate: (e) => depthOf(e) >= 3,
    move: 'reflect_only' },

  { name: 'default_observe',
    predicate: () => true,
    move: 'make_observation' },
];

const RULE_RATIONALE: Record<string, string> = {
  crisis_pass_through: 'Crisis is owned at Tier 1; defer to crisis handling and 988 enforcement.',
  advice_ask_overrides_just_listen: 'He asked for advice outright — an explicit ask overrides a standing "just listen".',
  honor_just_listen: 'Standing no-questions preference and he is not asking for advice — be present.',
  early_divorce_shock: 'Divorce shock window — meet the loss; do not open rebuild territories yet.',
  children_child_centered: 'Children in a divorce — protect the child-centered frame.',
  pushback_no_question: 'He has pushed back repeatedly — stop asking and advising; reflect.',
  explicit_practical_advice: 'He asked a direct practical question — answer it, do not force reflection.',
  ask_loss_naming: 'Grief with trust and depth — gently invite him to name the loss.',
  ask_grounding: 'Avoidance — a better, grounding question through the side door.',
  default_reflect_deep: 'Real depth present — reflect rather than probe.',
  default_observe: 'Nothing earned a stronger move — a gentle observation.',
};

// ─── Cross-cutting derivations ───

function topReferral(env: StateEnvelope): ReferralSuggestion {
  const cands: PathwayCandidate[] = env.sentinels.pathway_router?.candidates || [];
  const now = cands.find(c => c.when === 'now');
  if (now) return { warranted: true, target: now.target, when: 'now' };
  const later = cands.find(c => c.when === 'later');
  if (later) return { warranted: false, target: later.target, when: 'later' };
  return { warranted: false, target: null, when: null };
}

function finalize(rule: Rule, env: StateEnvelope): MoveDecision {
  const move = rule.move;
  return {
    move,
    rule: rule.name,
    ask_question: ASK_MOVES.has(move),
    craft_form: MOVE_TO_FORM[move],
    too_early_to_address: rule.too_early ? [...rule.too_early] : [],
    child_centered_frame: childrenInvolved(env) || !!rule.sets?.child_centered,
    refer_human_support: topReferral(env),
    rationale: RULE_RATIONALE[rule.name] ?? rule.name,
  };
}

/**
 * Commit to exactly ONE conversational move for this turn. Pure and deterministic
 * — reads the envelope + conversation state, mutates nothing.
 */
export function selectMove(env: StateEnvelope, cs?: ConversationState | null): MoveDecision {
  const state = cs ?? null;
  for (const rule of RULES) {
    if (rule.predicate(env, state)) return finalize(rule, env);
  }
  // Unreachable: default_observe is total. Kept for exhaustiveness.
  return finalize(RULES[RULES.length - 1], env);
}

/** Exposed for tests/observability: the ladder rule names in order. */
export const RULE_ORDER = RULES.map(r => r.name);
