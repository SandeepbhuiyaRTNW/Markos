/**
 * Turn-kind fork — deterministic tests (no DB, no LLM).
 * Run: npx tsx scripts/test-turn-kind-fork.ts
 *
 * Covers the plumbing the fork depends on: the classifier helpers (normalizeTurnKind,
 * looksUnfinished, nullifyEmpty), the move-selector routing per turn_kind + flag gating,
 * the composer gate (buildPriorityHierarchy) suppression + unfinished overlay, the nullable
 * coercion in listenerStackFromAnalysis, and the mcp-context depth-directive fix. The
 * classifier's SEMANTIC judgment is an LLM call and cannot be unit-tested offline — these
 * assert that each turn_kind VALUE drives the right downstream behavior.
 */

import {
  selectMove, turnKindForkEnabled, turnKindForkActive, moveSelectorEnforced,
} from '../src/lib/assessment/move-selector';
import { buildPriorityHierarchy } from '../src/lib/agents/orchestrator-v2-composer';
import { MOVE_CALIBRATION } from '../src/lib/agents/move-calibration';
import { normalizeTurnKind, looksUnfinished, nullifyEmpty } from '../src/lib/understanding/stack';
import type { UnderstandingAnalysis } from '../src/lib/understanding/stack';
import { createStateEnvelope, listenerStackFromAnalysis } from '../src/lib/agents/state-envelope-utils';
import { createMCPContext, buildContextSummary } from '../src/lib/agents/mcp-context';
import type { StateEnvelope, ListenerStackOutput } from '../src/lib/agents/state-envelope';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function lstack(over: Partial<ListenerStackOutput> = {}): ListenerStackOutput {
  return {
    words: '', emotion: '', pattern: '', the_man: '', the_silence: '', depth_level: 1,
    depth_opportunity: '', silence_question: '', emotional_trajectory: 'neutral', primary_emotion: 'neutral',
    ...over,
  };
}
function envWith(over: Partial<ListenerStackOutput> = {}, utterance = '', historyLen = 0): StateEnvelope {
  const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance, conversationHistory: [], userName: null });
  env.conversation_history = Array.from({ length: historyLen }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: 'x' }));
  env.sentinels.listener_stack = lstack(over);
  return env;
}
function ua(over: Partial<UnderstandingAnalysis> = {}): UnderstandingAnalysis {
  return {
    layer1_words: 'x', layer2_emotion: 'x', layer3_pattern: 'x', layer4_the_man: 'x',
    layer5_the_silence: null, primary_emotion: 'neutral', depth_level: 1,
    depth_opportunity: null, silence_question: null, emotional_trajectory: 'flat',
    turn_kind: 'emotional_disclosure', unfinished: false, ...over,
  };
}
// Toggle the fork flag by env var (read at call time), restoring after.
function withFork(on: boolean, fn: () => void) {
  const prev = process.env.TURN_KIND_FORK;
  process.env.TURN_KIND_FORK = on ? 'true' : 'false';
  try { fn(); } finally { if (prev === undefined) delete process.env.TURN_KIND_FORK; else process.env.TURN_KIND_FORK = prev; }
}

console.log('\n── A. Classifier helpers (pure) ──');
assert("normalizeTurnKind('problem_work')", normalizeTurnKind('problem_work') === 'problem_work');
assert("normalizeTurnKind('Problem Work') -> problem_work", normalizeTurnKind('Problem Work') === 'problem_work');
assert("normalizeTurnKind('mixed')", normalizeTurnKind('mixed') === 'mixed');
assert("normalizeTurnKind('casual')", normalizeTurnKind('casual') === 'casual');
assert("normalizeTurnKind('garbage') -> emotional_disclosure (SAFE default)", normalizeTurnKind('garbage') === 'emotional_disclosure');
assert('normalizeTurnKind(undefined) -> emotional_disclosure', normalizeTurnKind(undefined) === 'emotional_disclosure');
assert('normalizeTurnKind never defaults to problem_work', normalizeTurnKind('') !== 'problem_work' && normalizeTurnKind(null) !== 'problem_work');

assert("looksUnfinished('we need to figure out') -> true", looksUnfinished('we need to figure out') === true);
assert("looksUnfinished('...thinking about') -> true", looksUnfinished('I was thinking about') === true);
assert("looksUnfinished em-dash cut -> true", looksUnfinished('we need to figure out—') === true);
assert("looksUnfinished('I love you') -> false (trailing pronoun is NOT flagged)", looksUnfinished('I love you') === false);
assert("looksUnfinished('I am doing fine.') -> false", looksUnfinished('I am doing fine.') === false);
assert("looksUnfinished('should I take the job') -> false (complete-ish)", looksUnfinished('should I take the job') === false);

assert("nullifyEmpty('') -> null", nullifyEmpty('') === null);
assert('nullifyEmpty(null) -> null', nullifyEmpty(null) === null);
assert("nullifyEmpty('none') -> null", nullifyEmpty('none') === null);
assert("nullifyEmpty('too early to tell') -> null", nullifyEmpty('too early to tell') === null);
assert("nullifyEmpty('real thing') passes through", nullifyEmpty('real thing') === 'real thing');

console.log('\n── B. Flags ──');
assert('fork default ON', turnKindForkEnabled() === true && moveSelectorEnforced() === true && turnKindForkActive() === true);
withFork(false, () => assert('TURN_KIND_FORK=false disables the fork', turnKindForkActive() === false));

console.log('\n── C. Move selector — routing per turn_kind (fork ON) ──');
const pw = selectMove(envWith({ turn_kind: 'problem_work' }, 'trying to decide between the auditorium and the co-working space'));
assert('problem_work -> engage_the_problem', pw.move === 'engage_the_problem', pw.move);
assert('problem_work rule = engage_problem_work', pw.rule === 'engage_problem_work', pw.rule);
assert('engage_the_problem asks about the DECISION (ask_question true)', pw.ask_question === true);

const mixed = selectMove(envWith({ turn_kind: 'mixed', depth_level: 2 }, 'trying to decide whether to lend my brother the money'));
assert('mixed -> engage_the_problem (rule engage_problem_mixed)', mixed.move === 'engage_the_problem' && mixed.rule === 'engage_problem_mixed', mixed.rule);

const casual = selectMove(envWith({ turn_kind: 'casual' }, 'just checking in, decent day'));
assert('casual -> NOT engage_the_problem', casual.move !== 'engage_the_problem', casual.move);

const emo = selectMove(envWith({ turn_kind: 'emotional_disclosure', depth_level: 4 }, 'my dad died and I never cried'));
assert('emotional_disclosure -> NOT engage_the_problem', emo.move !== 'engage_the_problem', emo.move);

const crisisPw = selectMove((() => { const e = envWith({ turn_kind: 'problem_work' }, 'i want to end it'); e.sentinels.crisis.level = 'acute'; return e; })());
assert('crisis + problem_work -> crisis_protocol (crisis always wins)', crisisPw.move === 'crisis_protocol');

const askPw = selectMove(envWith({ turn_kind: 'problem_work' }, 'what should i do about the venue'));
assert('problem_work + explicit advice ask -> give_practical_advice (advice wins over engage)', askPw.move === 'give_practical_advice', askPw.move);

console.log('\n── D. Flag gating + emotional turns UNCHANGED ──');
withFork(false, () => {
  const pwOff = selectMove(envWith({ turn_kind: 'problem_work' }, 'trying to decide between the auditorium and the co-working space'));
  assert('fork OFF: problem_work does NOT engage_the_problem (old ladder)', pwOff.move !== 'engage_the_problem', pwOff.move);
});
let emoOn = '', emoOff = '';
withFork(true, () => { emoOn = selectMove(envWith({ turn_kind: 'emotional_disclosure', depth_level: 4 }, 'my dad died and I never cried')).move; });
withFork(false, () => { emoOff = selectMove(envWith({ turn_kind: 'emotional_disclosure', depth_level: 4 }, 'my dad died and I never cried')).move; });
assert('emotional_disclosure move IDENTICAL fork on vs off', emoOn === emoOff && emoOn !== 'engage_the_problem', `${emoOn} vs ${emoOff}`);

console.log('\n── E. Composer gate — buildPriorityHierarchy ──');
const pwHier = buildPriorityHierarchy(envWith({ turn_kind: 'problem_work', silence_question: 'what are you avoiding by planning this?', depth_opportunity: 'go underneath the logistics' }));
assert('problem_work block present (ENGAGE THE DECISION)', pwHier.includes('PROBLEM-WORK') && pwHier.includes('ENGAGE THE DECISION'));
assert('problem_work SUPPRESSES the (invented) silence question', !pwHier.includes('what are you avoiding by planning this?') && !pwHier.includes('SILENCE QUESTION'));
assert('problem_work SUPPRESSES the depth move ("Follow this direction")', !pwHier.includes('Follow this direction') && !pwHier.includes('DEPTH MOVE'));

const emoHierOn = buildPriorityHierarchy(envWith({ turn_kind: 'emotional_disclosure', depth_level: 4, silence_question: 'when did you stop believing your needs mattered?' }));
let emoHierOff = '';
withFork(false, () => { emoHierOff = buildPriorityHierarchy(envWith({ turn_kind: 'emotional_disclosure', depth_level: 4, silence_question: 'when did you stop believing your needs mattered?' })); });
assert('emotional_disclosure hierarchy BYTE-IDENTICAL fork on vs off', emoHierOn === emoHierOff);
assert('emotional_disclosure still injects PRIORITY 1 — SILENCE QUESTION', emoHierOn.includes('PRIORITY 1 — SILENCE QUESTION') && emoHierOn.includes('when did you stop believing your needs mattered?'));

const unfin = buildPriorityHierarchy(envWith({ turn_kind: 'problem_work', unfinished: true }, 'we need to figure out'));
assert('unfinished -> UNFINISHED THOUGHT overlay + invite to finish', unfin.includes('UNFINISHED THOUGHT') && unfin.includes('invite him to finish'));
assert('unfinished does NOT pivot to a new question', unfin.includes('Do NOT pivot to a new question'));

console.log('\n── F. Nullable coercion + calibration ──');
const ls = listenerStackFromAnalysis(ua({ turn_kind: 'problem_work', unfinished: true, layer5_the_silence: null, depth_opportunity: null, silence_question: null }));
assert('null silence fields coerce to empty string at the boundary', ls.the_silence === '' && ls.depth_opportunity === '' && ls.silence_question === '');
assert('turn_kind + unfinished carried onto the listener stack', ls.turn_kind === 'problem_work' && ls.unfinished === true);
assert('engage_the_problem calibration exists + forbids the "underneath" pivot', !!MOVE_CALIBRATION['engage_the_problem'] && MOVE_CALIBRATION['engage_the_problem'].voice.includes('pulling you away'));

console.log('\n── G. mcp-context depth directive (#4) ──');
function summaryFor(turn_kind: UnderstandingAnalysis['turn_kind']): string {
  const ctx = createMCPContext({ userId: 'u', conversationId: 'c', userMessage: 'x', conversationHistory: [] });
  ctx.understanding = ua({ turn_kind, depth_level: 1 });
  return buildContextSummary(ctx);
}
assert('problem_work + depth 1: NO "underneath the analysis" emotionalize directive', !summaryFor('problem_work').includes('underneath the analysis'));
assert('emotional_disclosure + depth 1: directive STILL fires (unchanged)', summaryFor('emotional_disclosure').includes('underneath the analysis'));

console.log(`\n──────────\n  passed: ${passed}   failed: ${failed}\n`);
if (failed > 0) process.exit(1);
