/**
 * Integration tests for Move Selector -> composer wiring (feature/move-selector-enable).
 * Run: npx tsx scripts/test-move-selector-wiring.ts
 *
 * Deterministic — no DB, no LLM. Proves: B2 load-bearing question strip; the three
 * pacing cases (early-shock no deep question, practical->advice, crisis overrides);
 * question-source suppression in the priority hierarchy; and flag-off parity.
 */

import { selectMove, MOVE_TO_FORM, moveSelectorEnabled } from '../src/lib/assessment/move-selector';
import { MOVE_CALIBRATION } from '../src/lib/agents/move-calibration';
import { buildEnvelopeContextSummary } from '../src/lib/agents/state-envelope-utils';
import { stripQuestionSentences, enforceSocraticDiscipline } from '../src/lib/craft/craft-layer';
import { enforceMovePolicy, renderMoveDirective, buildPriorityHierarchy } from '../src/lib/agents/orchestrator-v2-composer';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import type { StateEnvelope, ListenerStackOutput, CrisisLevel, SilenceType, Phase } from '../src/lib/agents/state-envelope';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function stubListener(depth: number, silenceQ = ''): ListenerStackOutput {
  return { words: '', emotion: '', pattern: '', the_man: '', the_silence: '', depth_level: depth,
    depth_opportunity: '', silence_question: silenceQ, emotional_trajectory: 'neutral', primary_emotion: 'neutral' };
}
function makeEnv(o: { utterance?: string; crisis?: CrisisLevel; sessionCount?: number; arena?: Record<string, number>;
  phase?: Phase; silence?: SilenceType; depth?: number; silenceQ?: string; trust?: { cognitive?: number; affective?: number } } = {}): StateEnvelope {
  const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance: o.utterance ?? '', conversationHistory: [], userName: null });
  if (o.crisis) env.sentinels.crisis.level = o.crisis;
  env.sentinels.memory.session_count = o.sessionCount ?? 0;
  if (o.arena) { const primary = Object.entries(o.arena).sort((a, b) => b[1] - a[1])[0]?.[0] || 'work'; env.assessment.arena = { weights: o.arena, primary }; }
  if (o.phase) env.assessment.phase = { label: o.phase, confidence: 0.8 };
  if (o.silence) env.assessment.silence_type = { label: o.silence, evidence: '', confidence: 0.8 };
  env.sentinels.listener_stack = stubListener(o.depth ?? 1, o.silenceQ ?? '');
  if (o.trust) env.assessment.trust = { cognitive: o.trust.cognitive ?? 0.5, affective: o.trust.affective ?? 0.2 };
  return env;
}

console.log('\n── A. B2 — stripQuestionSentences (the load-bearing filter, pure) ──');
assert('drops a trailing question, keeps the reflection',
  stripQuestionSentences('You let it rot. What made you hold on so long?') === 'You let it rot.');
assert('no question -> unchanged',
  stripQuestionSentences('You let it rot.') === 'You let it rot.');
assert('ALL-question -> original (never blanks the response)',
  stripQuestionSentences('What are you feeling?') === 'What are you feeling?');
assert('multi-sentence: keeps both reflections, drops the question',
  stripQuestionSentences("Three weeks, man. That's heavy. Where do you go from here?") === "Three weeks, man. That's heavy.");

console.log('\n── B. B2 — enforceMovePolicy post-gen filter (move = single authority on asking) ──');
const noAskMove = selectMove(makeEnv({ utterance: 'my wife left me', arena: { divorce: 0.8 }, sessionCount: 1 }));
const askMove = selectMove(makeEnv({ utterance: "i don't want to talk about it", silence: 'avoidance', depth: 2 }));
assert('setup: shock move forbids a question (ask_question=false)', noAskMove.ask_question === false, noAskMove.move);
assert('setup: grounding move allows a question (ask_question=true)', askMove.ask_question === true, askMove.move);
const draftWithQ = 'I hear the weight in that. What are you most afraid of right now?';
assert('B2 CENTERPIECE: move=no-ask + enforce -> trailing question STRIPPED from output',
  enforceMovePolicy(draftWithQ, { moveDecision: noAskMove, enforceMovePolicy: true }) === 'I hear the weight in that.',
  enforceMovePolicy(draftWithQ, { moveDecision: noAskMove, enforceMovePolicy: true }));
assert('move=ask + enforce -> question preserved',
  enforceMovePolicy(draftWithQ, { moveDecision: askMove, enforceMovePolicy: true }) === draftWithQ);
assert('flag OFF (enforce=false) -> passthrough, question preserved (byte-identical)',
  enforceMovePolicy(draftWithQ, { moveDecision: noAskMove, enforceMovePolicy: false }) === draftWithQ);
assert('flag OFF + null move -> content unchanged',
  enforceMovePolicy(draftWithQ, { moveDecision: null, enforceMovePolicy: false }) === draftWithQ);
// The REAL post-gen sequence: form-based strip (enforceSocraticDiscipline for a
// reflection form) THEN the move-based backstop (enforceMovePolicy). No '?' survives.
const reflectForm = { form: 'reflection' as const, pacing: 'full' as const, metaphor_hint: null, style_override: null };
const seqDraft = 'You let it rot, man. What are you most afraid of right now?';
const afterSequence = enforceMovePolicy(enforceSocraticDiscipline(seqDraft, reflectForm), { moveDecision: noAskMove, enforceMovePolicy: true });
assert('B2 FINAL OUTPUT: reflect_only draft ending in a question -> NO question survives the post-gen sequence',
  !afterSequence.includes('?') && afterSequence.length > 0, afterSequence);

console.log('\n── C. Integration — the three pacing cases ──');
const shock = selectMove(makeEnv({ utterance: 'my wife left me three weeks ago', arena: { divorce: 0.8 }, sessionCount: 1 }));
assert('early-divorce-shock -> reflect_only, NO question (no deep/identity probe)',
  shock.move === 'reflect_only' && shock.ask_question === false);
assert('early-divorce-shock defers identity_rebuild etc. (too_early)',
  shock.too_early_to_address.includes('identity_rebuild'));
const practical = selectMove(makeEnv({ utterance: 'what should i do about the mortgage' }));
assert('practical-help ask -> give_practical_advice (statement, not a probe)',
  practical.move === 'give_practical_advice' && practical.ask_question === false && practical.craft_form === MOVE_TO_FORM['give_practical_advice']);
const crisis = selectMove(makeEnv({ utterance: 'i want to end it', crisis: 'acute' }));
assert('crisis OVERRIDES everything -> crisis_protocol (rung 1)', crisis.move === 'crisis_protocol');

console.log('\n── D. Suppression — priority hierarchy silence-question gated by allowQuestion ──');
const envWithSilenceQ = makeEnv({ depth: 2, silenceQ: 'What are you not saying about her?' });
const phNoAsk = buildPriorityHierarchy(envWithSilenceQ, { allowQuestion: false });
const phAsk = buildPriorityHierarchy(envWithSilenceQ, { allowQuestion: true });
assert('allowQuestion=false: SILENCE QUESTION priority is DROPPED', !phNoAsk.includes('SILENCE QUESTION'));
assert('allowQuestion=false: closer says make ONE statement (not ask)', phNoAsk.includes('make ONE statement') && !phNoAsk.includes('ask ONE question'));
assert('allowQuestion=true: SILENCE QUESTION priority present', phAsk.includes('SILENCE QUESTION'));
assert('allowQuestion=true: closer offers ask ONE question', phAsk.includes('ask ONE question'));

console.log('\n── E. Flag-off parity — renderMoveDirective ──');
assert('not enforced -> NO move directive injected (empty)',
  renderMoveDirective({ moveDecision: noAskMove, enforceMovePolicy: false }) === '');
assert('enforced + no-ask move -> MOVE POLICY block with MUST NOT ASK',
  (() => { const d = renderMoveDirective({ moveDecision: noAskMove, enforceMovePolicy: true }); return d.includes('MOVE POLICY') && d.includes('MUST NOT ASK'); })());

console.log('\n── F. Calibration directive — per-move, from the guide, SELECTED MOVE ONLY ──');
const reflectDir = renderMoveDirective({ moveDecision: shock, enforceMovePolicy: true }); // shock -> reflect_only
assert('reflect_only: carries Moment / Voice / Length calibration',
  reflectDir.includes('Moment:') && reflectDir.includes('Voice:') && reflectDir.includes('Length:'));
assert('reflect_only: voice = say the feeling back as a complete thought (from the guide)',
  reflectDir.includes('Say back the feeling'));
assert('reflect_only: friend-not-interviewer + no-question override + MUST NOT ASK',
  reflectDir.includes('RESPOND LIKE A FRIEND') && reflectDir.includes('do NOT end on a question') && reflectDir.includes('MUST NOT ASK'));
assert('reflect_only: length leans SHORT', reflectDir.includes('Short'));
assert('reflect_only: directive itself contains NO question mark (reads as a statement)',
  !reflectDir.includes('?'));
// ONE MOVE ONLY — the reflect_only directive must not carry any other move's calibration.
assert('ONE MOVE ONLY: reflect_only excludes give_practical_advice calibration',
  !reflectDir.includes('Fuller') && !reflectDir.toLowerCase().includes('asking for actual help'));
assert('ONE MOVE ONLY: reflect_only excludes stay_present calibration',
  !reflectDir.includes('more words weaken it'));
// Asking move: gets calibration but NOT the no-question override.
const askDir = renderMoveDirective({ moveDecision: askMove, enforceMovePolicy: true }); // ask_grounding
assert('ask_grounding: MAY ASK + calibration present, NO friend-no-question override',
  askDir.includes('MAY ASK') && askDir.includes('Voice:') && !askDir.includes('RESPOND LIKE A FRIEND'));
// give_practical_advice: fuller length, still non-asking.
const practicalDir = renderMoveDirective({ moveDecision: practical, enforceMovePolicy: true });
assert('give_practical_advice: length runs FULLER', practicalDir.includes('Fuller'));
assert('give_practical_advice: still no-ask -> no-question override present', practicalDir.includes('do NOT end on a question'));
// All 7 guide moves calibrated; acknowledge present though not yet selectable.
assert('all 7 guide moves have calibration (moment/voice/length)',
  ['reflect_only','stay_present','make_observation','acknowledge','ask_grounding_question','ask_loss_naming_question','give_practical_advice']
    .every(m => !!MOVE_CALIBRATION[m]?.moment && !!MOVE_CALIBRATION[m]?.voice && !!MOVE_CALIBRATION[m]?.length));

console.log('\n── G. Flag: TEMPORARY DEFAULT-ON + kill-switch ──');
delete process.env.MOVE_SELECTOR_ENABLED; delete process.env.MOVE_SELECTOR_ENFORCE; delete process.env.MOVE_SELECTOR_ENABLED_USERS; delete process.env.MOVE_SELECTOR_ENABLED_EMAILS;
assert('DEFAULT ON: enabled for everyone when nothing is set',
  moveSelectorEnabled('u1') === true && moveSelectorEnabled(null, 'x@y.com') === true && moveSelectorEnabled() === true);
process.env.MOVE_SELECTOR_ENABLED = 'false';
assert('kill-switch: MOVE_SELECTOR_ENABLED=false -> disabled for EVERYONE',
  moveSelectorEnabled('u1') === false && moveSelectorEnabled(null, 'x@y.com') === false);
process.env.MOVE_SELECTOR_ENABLED = '0';
assert('kill-switch: MOVE_SELECTOR_ENABLED=0 -> disabled', moveSelectorEnabled('u1') === false);
process.env.MOVE_SELECTOR_ENABLED = '1';
assert('explicit on -> enabled', moveSelectorEnabled('u1') === true);
delete process.env.MOVE_SELECTOR_ENABLED;
assert('cleared -> back to DEFAULT ON', moveSelectorEnabled('u1') === true);

console.log('\n── H. Finding 1 (P1) — crisis overrides all pacing (both paths) ──');
const crisisMove = selectMove(makeEnv({ crisis: 'acute', utterance: 'i want to end it' }));
assert('crisis env -> crisis_protocol', crisisMove.move === 'crisis_protocol');
const crisisResp = 'That matters that you said it out loud. Put 988 in your phone right now. Is there somewhere safe you can go tonight?';
assert('V2: enforceMovePolicy on crisis_protocol -> UNCHANGED (safety question preserved)',
  enforceMovePolicy(crisisResp, { moveDecision: crisisMove, enforceMovePolicy: true }) === crisisResp);
assert('V2: renderMoveDirective on crisis_protocol -> no directive injected',
  renderMoveDirective({ moveDecision: crisisMove, enforceMovePolicy: true }) === '');
assert('V1 guard: crisis turn -> strip SKIPPED (safety question preserved)',
  (!crisisMove.ask_question && crisisMove.move !== 'crisis_protocol') === false);
assert('contrast: a normal no-ask move WOULD strip', (!noAskMove.ask_question && noAskMove.move !== 'crisis_protocol') === true);

console.log('\n── I. Finding 2 — silence-question suppressed on no-ask turns ──');
const envSQ = makeEnv({ silenceQ: 'What are you not saying about her?' });
assert('no-ask (includeQuestionCandidates=false) -> NO SILENCE QUESTION block reaches the prompt',
  !buildEnvelopeContextSummary(envSQ, { includeQuestionCandidates: false }).includes('SILENCE QUESTION'));
assert('flag-off (includeQuestionCandidates=true) -> SILENCE QUESTION present (byte-identical)',
  buildEnvelopeContextSummary(envSQ, { includeQuestionCandidates: true }).includes('SILENCE QUESTION'));

console.log('\n── J. Finding 3 — backstop catches WRAPPED / emphasized questions ──');
assert('quoted trailing question stripped', stripQuestionSentences('You let it rot. "What now?"') === 'You let it rot.');
assert('markdown-emphasized trailing question stripped', stripQuestionSentences('That lands hard. **What should I do?**') === 'That lands hard.');
assert('plain reflection (no question) -> unchanged', stripQuestionSentences('You let it rot, man.') === 'You let it rot, man.');

console.log('\n── SUMMARY ──');
console.log(`  passed: ${passed}   failed: ${failed}`);
if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); }
else console.log('  ✅ SUITE PASSED');
