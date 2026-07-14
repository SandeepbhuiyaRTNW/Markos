/**
 * Deterministic unit tests for the Knowledge Intelligence selector (no DB, no LLM).
 * Usage: npx tsx scripts/test-knowledge-selector.ts
 *
 * The function emits INTENT only and never queries a database, so every case is
 * a pure function of (env, decision). Cases assert exact plan output; the suite
 * doubles as the spec. Refinement coverage: reflect_only + divorce-shock (wisdom
 * heavy-excluded) vs reflect_only + meaning conversation (wisdom allowed); and
 * "telling my kids about the divorce" (children rung: whisperer='divorce',
 * excludes kwml/shadow, toward=[]).
 */

import {
  selectKnowledgePlan, FULL_PSYCH_EXCLUDE, DEEP_PSYCH_EXCLUDE, PRACTICAL_EXCLUDE,
  type MoveDecisionInput,
} from '../src/lib/assessment/knowledge-selector';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import type { StateEnvelope, ListenerStackOutput, CrisisLevel, SilenceType } from '../src/lib/agents/state-envelope';

let passed = 0, failed = 0;
function assert(name: string, condition: boolean, detail: string = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function stubListener(depth: number): ListenerStackOutput {
  return {
    words: '', emotion: '', pattern: '', the_man: '', the_silence: '',
    depth_level: depth, depth_opportunity: '', silence_question: '',
    emotional_trajectory: 'neutral', primary_emotion: 'neutral',
  };
}

function makeEnv(o: {
  arena?: Record<string, number>;
  silence?: SilenceType | null;
  depth?: number;
  crisis?: CrisisLevel;
} = {}): StateEnvelope {
  const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance: '', conversationHistory: [], userName: null });
  if (o.crisis) env.sentinels.crisis.level = o.crisis;
  if (o.arena) {
    const primary = Object.entries(o.arena).sort((a, b) => b[1] - a[1])[0]?.[0] || 'work';
    env.assessment.arena = { weights: o.arena, primary };
  }
  if (o.silence) env.assessment.silence_type = { label: o.silence, evidence: '', confidence: 0.8 };
  if (o.depth !== undefined) env.sentinels.listener_stack = stubListener(o.depth);
  return env;
}

function makeDecision(o: Partial<MoveDecisionInput> = {}): MoveDecisionInput {
  return { move: 'make_observation', too_early_to_address: [], child_centered_frame: false, ...o };
}

const ON = { enabled: true };
const OFF = { enabled: false };
const DIVORCE_TOO_EARLY = ['identity_rebuild', 'financial_strategy', 'dating', 'reconciliation'];

// ═════════════════════════════════════════════════════════════
console.log('\n── A. Feature flag / passthrough ──');
const a1 = selectKnowledgePlan(makeEnv(), makeDecision(), OFF);
assert('1  flag OFF -> passthrough', a1.rule === 'passthrough' && a1.wisdom.enabled && eq(a1.wisdom.excludeDomains, []));
assert('2  flag OFF -> questions on, whisperer on', a1.questions.enabled && a1.includeWhispererOutput && !a1.safetyOnly);
const a3 = selectKnowledgePlan(makeEnv(), makeDecision());  // no opts, KI_ENABLED unset -> default OFF
assert('3  default (no opts, env unset) -> passthrough', a3.rule === 'passthrough');
const a4 = selectKnowledgePlan(makeEnv(), makeDecision(), ON);  // flag on, no rule matches
assert('4  flag ON + no match -> default (full knowledge)', a4.rule === 'default' && a4.wisdom.enabled && eq(a4.wisdom.excludeDomains, []));
assert('5  passthrough and default have same wisdom/questions shape', eq(a1.wisdom, a4.wisdom) && eq(a1.questions, a4.questions));

console.log('\n── B. Crisis -> safety only ──');
const b6 = selectKnowledgePlan(makeEnv({ crisis: 'elevated' }), makeDecision(), ON);
assert('6  crisis level -> safetyOnly, wisdom+questions+whisperer off',
  b6.rule === 'crisis' && b6.safetyOnly && !b6.wisdom.enabled && !b6.questions.enabled && !b6.includeWhispererOutput);
assert('7  move crisis_protocol -> safetyOnly',
  selectKnowledgePlan(makeEnv(), makeDecision({ move: 'crisis_protocol' }), ON).safetyOnly === true);
assert('8  crisis + divorce shock -> crisis wins (safetyOnly)',
  selectKnowledgePlan(makeEnv({ crisis: 'acute', arena: { divorce: 0.8 } }), makeDecision({ too_early_to_address: DIVORCE_TOO_EARLY }), ON).rule === 'crisis');

console.log('\n── C. Divorce shock (exclusion-first; whisperer not arena) ──');
const c = selectKnowledgePlan(makeEnv({ arena: { divorce: 0.8 } }), makeDecision({ move: 'reflect_only', too_early_to_address: DIVORCE_TOO_EARLY }), ON);
assert('9  too_early set -> rule=divorce_shock', c.rule === 'divorce_shock');
assert('10 excludeDomains == FULL_PSYCH_EXCLUDE', eq(c.wisdom.excludeDomains, FULL_PSYCH_EXCLUDE), c.wisdom.excludeDomains.join(','));
assert('11 heavy wisdom suppressed (stoic + kwml excluded)', c.wisdom.excludeDomains.includes('stoic') && c.wisdom.excludeDomains.includes('kwml'));
assert('12 towardDomains == [divorce, grief]', eq(c.wisdom.towardDomains, ['divorce', 'grief']));
assert('13 questions route via whisperer=divorce (NOT arena)', eq(c.questions.whispererScope, ['divorce']) && c.questions.arenaScope === null);
assert('14 wisdom still enabled (toward divorce corpus if present)', c.wisdom.enabled === true);

console.log('\n── D. Grief (arena=grief AND whisperer=grief) ──');
const d = selectKnowledgePlan(makeEnv({ arena: { grief: 0.7 } }), makeDecision({ move: 'ask_loss_naming_question' }), ON);
assert('15 grief arena -> rule=grief', d.rule === 'grief');
assert('16 grief via silence type -> rule=grief',
  selectKnowledgePlan(makeEnv({ silence: 'grief' }), makeDecision(), ON).rule === 'grief');
assert('17 grief questions arena=[grief] AND whisperer=[grief]', eq(d.questions.arenaScope, ['grief']) && eq(d.questions.whispererScope, ['grief']));
assert('18 grief excludeDomains == FULL_PSYCH_EXCLUDE', eq(d.wisdom.excludeDomains, FULL_PSYCH_EXCLUDE));
assert('19 grief towardDomains == [grief]', eq(d.wisdom.towardDomains, ['grief']));

console.log('\n── E. Children -> concrete; co-parenting via divorce whisperer (REFINEMENT 2) ──');
// "telling my kids about the divorce": move-selector emits child_centered_frame,
// too_early empty (children rung, not shock) -> KI children rung.
const e = selectKnowledgePlan(makeEnv({ arena: { divorce: 0.6 } }), makeDecision({ move: 'make_observation', child_centered_frame: true }), ON);
assert('20 child_centered -> rule=children', e.rule === 'children');
assert('21 children excludes kwml AND shadow (== DEEP_PSYCH_EXCLUDE)', eq(e.wisdom.excludeDomains, DEEP_PSYCH_EXCLUDE) && e.wisdom.excludeDomains.includes('kwml') && e.wisdom.excludeDomains.includes('shadow'));
assert('22 children questions via whisperer=divorce (co-parenting)', eq(e.questions.whispererScope, ['divorce']));
assert('23 children towardDomains == [] (no fatherhood corpus)', eq(e.wisdom.towardDomains, []));
assert('24 children keeps wisdom enabled', e.wisdom.enabled === true);

console.log('\n── F. Practical -> no deep psychology ──');
const f = selectKnowledgePlan(makeEnv({ arena: { work: 0.6 } }), makeDecision({ move: 'give_practical_advice' }), ON);
assert('25 give_practical_advice -> rule=practical', f.rule === 'practical');
assert('26 practical excludeDomains == PRACTICAL_EXCLUDE (shadow/kwml/meaning/perma)', eq(f.wisdom.excludeDomains, PRACTICAL_EXCLUDE));
assert('27 practical does not push questions', f.questions.enabled === false);

console.log('\n── G. Reflect/present: no over-fire (REFINEMENT 1) ──');
// reflect_only + divorce-shock -> caught at rung 2, heavy wisdom EXCLUDED ("wisdom off").
const g28 = selectKnowledgePlan(makeEnv({ arena: { divorce: 0.8 } }), makeDecision({ move: 'reflect_only', too_early_to_address: DIVORCE_TOO_EARLY }), ON);
assert('28 reflect_only + divorce-shock -> rule=divorce_shock, heavy wisdom excluded',
  g28.rule === 'divorce_shock' && g28.wisdom.excludeDomains.includes('stoic') && g28.wisdom.excludeDomains.includes('kwml'));
// reflect_only + meaning/purpose conversation (low depth, no shock/grief) -> wisdom ALLOWED.
const g29 = selectKnowledgePlan(makeEnv({ arena: { midlife: 0.5 }, depth: 2 }), makeDecision({ move: 'reflect_only' }), ON);
assert('29 reflect_only + meaning talk -> rule=reflect_light, wisdom ALLOWED (no exclusions)',
  g29.rule === 'reflect_light' && g29.wisdom.enabled === true && eq(g29.wisdom.excludeDomains, []));
assert('30 stay_present + meaning talk -> reflect_light, wisdom allowed',
  selectKnowledgePlan(makeEnv({ depth: 3 }), makeDecision({ move: 'stay_present' }), ON).rule === 'reflect_light');
// reflect/present + high emotional intensity (deep) -> wisdom OFF.
const g31 = selectKnowledgePlan(makeEnv({ depth: 4 }), makeDecision({ move: 'reflect_only' }), ON);
assert('31 reflect_only + depth>=4 -> rule=reflect_high_intensity, wisdom OFF',
  g31.rule === 'reflect_high_intensity' && g31.wisdom.enabled === false && g31.includeWhispererOutput === false);
assert('32 stay_present + depth 5 -> wisdom off',
  selectKnowledgePlan(makeEnv({ depth: 5 }), makeDecision({ move: 'stay_present' }), ON).wisdom.enabled === false);

console.log('\n── H. Precedence ──');
assert('33 divorce-shock + child_centered -> shock wins (rung 2 over rung 4)',
  selectKnowledgePlan(makeEnv({ arena: { divorce: 0.8 } }), makeDecision({ too_early_to_address: DIVORCE_TOO_EARLY, child_centered_frame: true }), ON).rule === 'divorce_shock');
assert('34 grief + practical -> grief wins (rung 3 over rung 5)',
  selectKnowledgePlan(makeEnv({ arena: { grief: 0.7 } }), makeDecision({ move: 'give_practical_advice' }), ON).rule === 'grief');

console.log('\n── I. DB-independence + determinism (emits intent only) ──');
const env35 = makeEnv({ arena: { divorce: 0.8 } });
const dec35 = makeDecision({ move: 'reflect_only', too_early_to_address: DIVORCE_TOO_EARLY });
const p1 = selectKnowledgePlan(env35, dec35, ON);
const p2 = selectKnowledgePlan(env35, dec35, ON);
assert('35 same input -> byte-identical plan (deterministic, no DB read)',
  eq(p1, p2) && eq(JSON.parse(JSON.stringify(p1)), p1), 'plan is plain serializable data — no DB handles, no promises');

// ═════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(50)}`);
console.log(`Knowledge Selector: ${passed} passed, ${failed} failed (of ${passed + failed})`);
if (failed > 0) process.exit(1);
