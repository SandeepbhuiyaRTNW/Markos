/**
 * Deterministic unit tests for the Conversation Move Selector (no DB, no LLM).
 * Usage: npx tsx scripts/test-move-selector.ts
 *
 * The suite doubles as the spec: each case maps to a rung on the rule ladder.
 * The session-1-vs-8 divorce pair (cases 13–17) is the feature's thesis; the
 * style-vs-advice override (cases 7–8) is the deliberate product decision.
 */

import { selectMove, MOVE_TO_FORM, DIVORCE_SHOCK_TOO_EARLY } from '../src/lib/assessment/move-selector';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import type {
  StateEnvelope, ListenerStackOutput, CrisisLevel, SilenceType, Phase, PathwayCandidate,
} from '../src/lib/agents/state-envelope';
import type { ConversationState } from '../src/lib/agents/conversation-state';

let passed = 0, failed = 0;
function assert(name: string, condition: boolean, detail: string = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function stubListener(depth: number): ListenerStackOutput {
  return {
    words: '', emotion: '', pattern: '', the_man: '', the_silence: '',
    depth_level: depth, depth_opportunity: '', silence_question: '',
    emotional_trajectory: 'neutral', primary_emotion: 'neutral',
  };
}

function makeEnv(o: {
  utterance?: string;
  sessionCount?: number;
  stylePreferences?: string | null;
  arena?: Record<string, number>;
  phase?: Phase;
  silence?: SilenceType | null;
  depth?: number;
  crisis?: CrisisLevel;
  pathway?: PathwayCandidate[];
} = {}): StateEnvelope {
  const env = createStateEnvelope({
    userId: 'u', conversationId: 'c', utterance: o.utterance ?? '', conversationHistory: [], userName: null,
  });
  if (o.crisis) env.sentinels.crisis.level = o.crisis;
  env.sentinels.memory.session_count = o.sessionCount ?? 0;
  env.sentinels.memory.style_preferences = o.stylePreferences ?? null;
  if (o.arena) {
    const primary = Object.entries(o.arena).sort((a, b) => b[1] - a[1])[0]?.[0] || 'work';
    env.assessment.arena = { weights: o.arena, primary };
  }
  if (o.phase) env.assessment.phase = { label: o.phase, confidence: 0.8 };
  if (o.silence) env.assessment.silence_type = { label: o.silence, evidence: '', confidence: 0.8 };
  if (o.depth !== undefined) env.sentinels.listener_stack = stubListener(o.depth);
  if (o.pathway) env.sentinels.pathway_router = { candidates: o.pathway };
  return env;
}

function makeCS(o: Partial<ConversationState> = {}): ConversationState {
  return {
    phase: 'understand', intent: 'exploration', hopelessnessLevel: 0,
    pushbackCount: 0, adviceLoopCount: 0, trajectoryDrift: 0,
    emotionalDirection: 'flat', loopBreaker: '', responseTemplate: null, ...o,
  };
}

const JUST_LISTEN = 'He asked Marcus to stop ending responses with questions. Respect this.';
const DIVORCE = { divorce: 0.8, love: 0.3 };

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n── A. Crisis pass-through ──');
assert('1  acute suicide -> crisis_protocol',
  selectMove(makeEnv({ crisis: 'acute', utterance: 'I want to end it' })).move === 'crisis_protocol');
assert('2  elevated/passive -> crisis_protocol',
  selectMove(makeEnv({ crisis: 'elevated', utterance: "what's the point" })).move === 'crisis_protocol');
assert('3  acute violence -> crisis_protocol',
  selectMove(makeEnv({ crisis: 'acute', utterance: 'I could hurt someone' })).move === 'crisis_protocol');
assert('4  acute DV -> crisis_protocol',
  selectMove(makeEnv({ crisis: 'acute' })).move === 'crisis_protocol');
assert('5  crisis beats a direct advice ask',
  selectMove(makeEnv({ crisis: 'acute', utterance: 'what should I do' })).move === 'crisis_protocol');
assert('6  crisis beats a standing style pref',
  selectMove(makeEnv({ crisis: 'elevated', stylePreferences: JUST_LISTEN })).move === 'crisis_protocol');

console.log('\n── B. Style “just listen” vs direct advice ask ──');
const b7 = selectMove(makeEnv({ stylePreferences: JUST_LISTEN, utterance: 'what should I do about telling my wife?' }));
assert('7  style pref + advice ask -> give_practical_advice (PRODUCT DECISION)', b7.move === 'give_practical_advice', `rule=${b7.rule}`);
assert('8  ...via advice_ask_overrides_just_listen rule', b7.rule === 'advice_ask_overrides_just_listen');
assert('9  style pref + venting (no ask) -> stay_present',
  selectMove(makeEnv({ stylePreferences: JUST_LISTEN, utterance: 'everything is just piling up and I am exhausted' })).move === 'stay_present');
assert('10 style pref “just be present” + no ask -> stay_present',
  selectMove(makeEnv({ stylePreferences: 'He wants me to just be present, not probing.', utterance: 'today was rough' })).move === 'stay_present');
const b11 = selectMove(makeEnv({ utterance: 'what should I do about my job?' }));
assert('11 no pref + advice ask -> give_practical_advice', b11.move === 'give_practical_advice', `rule=${b11.rule}`);
assert('12 ...via explicit_practical_advice rule', b11.rule === 'explicit_practical_advice');

console.log('\n── C. Early-divorce shock: SESSION 1 vs SESSION 8 (the thesis) ──');
const DIVORCE_UTTER = 'she filed for divorce and I do not know who I am anymore';
const c13 = selectMove(makeEnv({ utterance: DIVORCE_UTTER, arena: DIVORCE, sessionCount: 1, phase: 'unsilenced', depth: 4 }));
assert('13 session 1 divorce -> reflect_only', c13.move === 'reflect_only', `rule=${c13.rule}`);
assert('14 session 1 too_early == [identity_rebuild, financial_strategy, dating, reconciliation]',
  JSON.stringify(c13.too_early_to_address) === JSON.stringify(DIVORCE_SHOCK_TOO_EARLY), JSON.stringify(c13.too_early_to_address));
const c15 = selectMove(makeEnv({ utterance: DIVORCE_UTTER, arena: DIVORCE, sessionCount: 8, phase: 'unleashed', depth: 4 }));
assert('15 session 8 divorce (same utterance) -> reflect_only', c15.move === 'reflect_only', `rule=${c15.rule}`);
assert('16 session 8 too_early == [] (those topics open up)', JSON.stringify(c15.too_early_to_address) === '[]', JSON.stringify(c15.too_early_to_address));
assert('17 session 8 is NOT the shock rule', c15.rule === 'default_reflect_deep' && c13.rule === 'early_divorce_shock');
const c18 = selectMove(makeEnv({ utterance: DIVORCE_UTTER, arena: DIVORCE, sessionCount: 2, phase: 'unsilenced', depth: 3 }));
assert('18 session 2 divorce -> shock (too_early non-empty)', c18.rule === 'early_divorce_shock' && c18.too_early_to_address.length === 4);
const c19 = selectMove(makeEnv({ utterance: 'what should I do about the house?', arena: DIVORCE, sessionCount: 1, phase: 'unsilenced', depth: 2 }));
assert('19 divorce shock beats a bare advice ask (no pref) -> reflect_only', c19.move === 'reflect_only', `rule=${c19.rule}`);

console.log('\n── D. Children -> child-centered frame ──');
const d20 = selectMove(makeEnv({ utterance: 'the divorce is final but my kids are caught in the middle', arena: DIVORCE, sessionCount: 8, phase: 'unleashed', depth: 3 }));
assert('20 divorce + children -> make_observation + child_centered', d20.move === 'make_observation' && d20.child_centered_frame === true, `rule=${d20.rule}`);
assert('21 ...via children_child_centered rule', d20.rule === 'children_child_centered');
const d22 = selectMove(makeEnv({ utterance: 'how do I help my son study better?', arena: { fatherhood: 0.7 }, sessionCount: 5, depth: 2 }));
assert('22 fatherhood advice (no divorce) -> give_practical_advice, child_centered flag still true', d22.move === 'give_practical_advice' && d22.child_centered_frame === true, `rule=${d22.rule}`);
const d23 = selectMove(makeEnv({ utterance: 'she left and the kids are wrecked, I do not know who I am', arena: DIVORCE, sessionCount: 1, phase: 'unsilenced', depth: 4 }));
assert('23 divorce shock + children -> reflect_only (shock above children), child_centered true, too_early set',
  d23.move === 'reflect_only' && d23.child_centered_frame === true && d23.too_early_to_address.length === 4, `rule=${d23.rule}`);
assert('24 no children -> child_centered false',
  selectMove(makeEnv({ utterance: 'work has been crushing me', arena: { work: 0.7 }, depth: 2 })).child_centered_frame === false);
assert('25 custody conflict in divorce -> child_centered true',
  selectMove(makeEnv({ utterance: 'the custody fight is brutal', arena: DIVORCE, sessionCount: 6, phase: 'unleashed', depth: 3 })).child_centered_frame === true);

console.log('\n── E. Pushback >= 2 ──');
assert('26 pushback 2 -> reflect_only', selectMove(makeEnv({ utterance: 'that does not help', depth: 2 }), makeCS({ pushbackCount: 2 })).move === 'reflect_only');
assert('27 pushback 3 -> reflect_only', selectMove(makeEnv({ depth: 2 }), makeCS({ pushbackCount: 3 })).move === 'reflect_only');
assert('28 pushback 1 -> NOT the pushback rule (falls to default)', selectMove(makeEnv({ depth: 1 }), makeCS({ pushbackCount: 1 })).rule !== 'pushback_no_question');
const e29 = selectMove(makeEnv({ utterance: 'what should I do then', depth: 2 }), makeCS({ pushbackCount: 2 }));
assert('29 pushback 2 + advice ask -> reflect_only (pushback beats advice)', e29.move === 'reflect_only' && e29.rule === 'pushback_no_question');
assert('30 pushback 2 no question asked', selectMove(makeEnv({ depth: 2 }), makeCS({ pushbackCount: 2 })).ask_question === false);

console.log('\n── F. Explicit practical advice ──');
assert('31 “what should I do about my resume” -> give_practical_advice',
  selectMove(makeEnv({ utterance: 'what should I do about my resume?' })).move === 'give_practical_advice');
assert('32 “how do I ask for a raise” -> give_practical_advice',
  selectMove(makeEnv({ utterance: 'how do I ask for a raise?' })).move === 'give_practical_advice');
assert('33 intent seeking_direction (no regex) -> give_practical_advice',
  selectMove(makeEnv({ utterance: 'I am stuck on this whole thing' }), makeCS({ intent: 'seeking_direction' })).move === 'give_practical_advice');
assert('34 advice ask + grief silence -> advice (above ask_loss_naming)',
  selectMove(makeEnv({ utterance: 'what should I do, I miss her so much', arena: { grief: 0.8 }, silence: 'grief', phase: 'unleashed', depth: 4 })).move === 'give_practical_advice');
assert('35 advice move does not ask a question',
  selectMove(makeEnv({ utterance: 'what should I do?' })).ask_question === false);

console.log('\n── G. Question-selecting moves ──');
const g36 = selectMove(makeEnv({ utterance: 'I keep thinking about my father', arena: { grief: 0.8 }, silence: 'grief', phase: 'unleashed', depth: 3 }));
assert('36 grief silence + depth>=3 + trust -> ask_loss_naming_question', g36.move === 'ask_loss_naming_question', `rule=${g36.rule}`);
assert('37 ask_loss_naming asks a question', g36.ask_question === true);
assert('38 grief silence depth 2 -> not loss-naming (falls to default)',
  selectMove(makeEnv({ silence: 'grief', phase: 'unleashed', depth: 2 })).move === 'make_observation');
assert('39 grief silence but unsilenced -> not loss-naming (too early to invite)',
  selectMove(makeEnv({ silence: 'grief', phase: 'unsilenced', depth: 4 })).move === 'reflect_only');
assert('40 avoidance silence depth 2 -> ask_grounding_question',
  selectMove(makeEnv({ silence: 'avoidance', depth: 2 })).move === 'ask_grounding_question');
assert('41 avoidance silence depth 4 -> not grounding (falls to default)',
  selectMove(makeEnv({ silence: 'avoidance', depth: 4 })).move === 'reflect_only');

console.log('\n── H. Depth-based default ──');
assert('42 depth 4 -> reflect_only', selectMove(makeEnv({ depth: 4 })).move === 'reflect_only');
assert('43 depth 3 -> reflect_only', selectMove(makeEnv({ depth: 3 })).move === 'reflect_only');
assert('44 depth 2 -> make_observation', selectMove(makeEnv({ depth: 2 })).move === 'make_observation');
assert('45 depth 1 -> make_observation', selectMove(makeEnv({ depth: 1 })).move === 'make_observation');
assert('46 depth 5 -> reflect_only', selectMove(makeEnv({ depth: 5 })).move === 'reflect_only');

console.log('\n── I. Move->form map, ask flag, and referral (reused from Pathway Router) ──');
assert('47 MOVE_TO_FORM maps moves to craft forms',
  MOVE_TO_FORM.stay_present === 'presence' && MOVE_TO_FORM.reflect_only === 'reflection' &&
  MOVE_TO_FORM.ask_grounding_question === 'question' && MOVE_TO_FORM.give_practical_advice === 'statement' &&
  MOVE_TO_FORM.crisis_protocol === 'statement' && MOVE_TO_FORM.make_observation === 'statement');
const refNow = selectMove(makeEnv({ utterance: 'I think I need therapy', depth: 2, pathway: [{ target: 'therapy', description: '', when: 'now', confidence: 0.7 }] }));
assert('48 pathway “now” -> refer warranted, target therapy', refNow.refer_human_support.warranted === true && refNow.refer_human_support.target === 'therapy');
const refNotYet = selectMove(makeEnv({ depth: 2, pathway: [{ target: 'mens_circle', description: '', when: 'not_yet', confidence: 0.5 }] }));
assert('49 pathway “not_yet” only -> refer not warranted', refNotYet.refer_human_support.warranted === false);
assert('50 no pathway candidates -> refer not warranted, no target',
  (() => { const d = selectMove(makeEnv({ depth: 2 })); return d.refer_human_support.warranted === false && d.refer_human_support.target === null; })());

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(50)}`);
console.log(`Move Selector: ${passed} passed, ${failed} failed (of ${passed + failed})`);
if (failed > 0) process.exit(1);
