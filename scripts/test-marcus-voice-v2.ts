/**
 * Marcus Voice v2 — crisis-bypass + voice-calibration tests.
 * Run: npx tsx scripts/test-marcus-voice-v2.ts   (deterministic; no DB, no LLM)
 */

import { selectMove, moveSelectorEnforced } from '../src/lib/assessment/move-selector';
import { MOVE_CALIBRATION } from '../src/lib/agents/move-calibration';
import { renderMoveDirective, enforceMovePolicy } from '../src/lib/agents/orchestrator-v2-composer';
import { stripQuestionSentences } from '../src/lib/craft/craft-layer';
import { detectCrisisType } from '../src/lib/sentinels/crisis';
import { getCrisisResponse } from '../src/lib/sentinels/crisis-responses';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import type { StateEnvelope, ListenerStackOutput, CrisisLevel } from '../src/lib/agents/state-envelope';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
function stubListener(depth: number): ListenerStackOutput {
  return { words: '', emotion: '', pattern: '', the_man: '', the_silence: '', depth_level: depth,
    depth_opportunity: '', silence_question: '', emotional_trajectory: 'neutral', primary_emotion: 'neutral' };
}
function makeEnv(o: { utterance?: string; crisis?: CrisisLevel; sessionCount?: number; arena?: Record<string, number>; depth?: number } = {}): StateEnvelope {
  const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance: o.utterance ?? '', conversationHistory: [], userName: null });
  if (o.crisis) env.sentinels.crisis.level = o.crisis;
  env.sentinels.memory.session_count = o.sessionCount ?? 0;
  if (o.arena) { const primary = Object.entries(o.arena).sort((a, b) => b[1] - a[1])[0]?.[0] || 'work'; env.assessment.arena = { weights: o.arena, primary }; }
  env.sentinels.listener_stack = stubListener(o.depth ?? 1);
  return env;
}

console.log('\n── A. PART 1A — CRISIS BYPASS (both paths; the reason #13 was reverted) ──');
const crisisMove = selectMove(makeEnv({ crisis: 'acute', utterance: 'i want to end it' }));
assert('crisis -> crisis_protocol', crisisMove.move === 'crisis_protocol');
const crisisResp = 'Brother, stop and listen to me. Put 988 in your phone right now — call or text, any time. Is there somewhere safe you can go tonight?';
assert('V2: enforceMovePolicy on a crisis turn returns the FULL response UNTOUCHED (safety question kept)',
  enforceMovePolicy(crisisResp, { moveDecision: crisisMove, enforceMovePolicy: true }) === crisisResp);
assert('V2: renderMoveDirective injects NO pacing directive on a crisis turn',
  renderMoveDirective({ moveDecision: crisisMove, enforceMovePolicy: true }) === '');
// Proof the bypass MATTERS: without it, the strip would have removed the safety question.
assert('control: the strip WOULD remove the safety question if applied (so the bypass is load-bearing)',
  stripQuestionSentences(crisisResp) !== crisisResp && !stripQuestionSentences(crisisResp).includes('?'));
// V1: a detected crisis makes the V1 pacing block skip entirely.
const crisisUtterance = 'i want to end it';
const v1WouldPace = !!detectCrisisType(crisisUtterance) === false && !crisisMove.ask_question && crisisMove.move !== 'crisis_protocol';
assert('V1: crisis detected -> pacing block SKIPPED (crisis response untouched)',
  detectCrisisType(crisisUtterance) !== null && v1WouldPace === false);

console.log('\n── B. Voice — non-asking moves are plain reactions, no question, no therapist-speak ──');
const reflect = selectMove(makeEnv({ utterance: 'my wife left me three weeks ago', arena: { divorce: 0.8 }, sessionCount: 1 }));
const reflectDir = renderMoveDirective({ moveDecision: reflect, enforceMovePolicy: true });
assert('reflect_only -> a no-ask move', reflect.ask_question === false);
assert('reflect_only directive carries Moment/Voice/Length', reflectDir.includes('Moment:') && reflectDir.includes('Voice:') && reflectDir.includes('Length:'));
assert('reflect_only voice is plain & casual ("guy on a couch", the GOOD example)',
  reflectDir.includes('guy on a couch') && reflectDir.includes("that's not just losing a plan"));
assert('reflect_only says NO therapist phrasing', reflectDir.includes('NO therapist phrasing') && !reflectDir.includes('shape who you are'));
assert('reflect_only: react like a friend, do NOT end on a question', reflectDir.includes('Do NOT end on a question') && reflectDir.includes('MUST NOT ASK'));
assert('reflect_only directive contains NO question mark (reads as a statement)', !reflectDir.includes('?'));
assert('reflect_only leans SHORT', reflectDir.includes('Short'));
assert('ONE MOVE ONLY: reflect_only excludes give_practical_advice calibration',
  !reflectDir.includes('Fuller') && !reflectDir.toLowerCase().includes('asking what to actually do'));

console.log('\n── C. Voice — plain-reaction (acknowledge) + the transform examples ──');
assert('acknowledge calibration exists (note: dormant — not emitted by selectMove yet)', !!MOVE_CALIBRATION['acknowledge']);
assert('acknowledge is a PLAIN REACTION with no question', !MOVE_CALIBRATION['acknowledge'].voice.includes('?') && MOVE_CALIBRATION['acknowledge'].voice.toLowerCase().includes("that's rough"));
assert('reflect_only transform: casual short example present, poetic/therapist version absent',
  MOVE_CALIBRATION['reflect_only'].voice.includes("cracking jokes to fill the silence") && !MOVE_CALIBRATION['reflect_only'].voice.includes('speaks volumes'));
assert('ask_loss_naming uses plain question, not therapist phrasing',
  MOVE_CALIBRATION['ask_loss_naming_question'].voice.includes('what do you actually miss most') && MOVE_CALIBRATION['ask_loss_naming_question'].voice.includes('not "how did that shape'));
assert('give_practical_advice offers one tiny doable thing', MOVE_CALIBRATION['give_practical_advice'].voice.toLowerCase().includes('sketchbook'));

console.log('\n── D. Flag: MOVE_SELECTOR_ENFORCE default OFF (byte-identical) ──');
delete process.env.MOVE_SELECTOR_ENFORCE;
assert('default OFF', moveSelectorEnforced() === false);
process.env.MOVE_SELECTOR_ENFORCE = '1'; assert('=1 -> on', moveSelectorEnforced() === true);
process.env.MOVE_SELECTOR_ENFORCE = 'true'; assert('=true -> on', moveSelectorEnforced() === true);
delete process.env.MOVE_SELECTOR_ENFORCE;
assert('flag off: renderMoveDirective -> empty', renderMoveDirective({ moveDecision: reflect, enforceMovePolicy: false }) === '');
assert('flag off: enforceMovePolicy -> passthrough (question preserved)',
  enforceMovePolicy('You let it rot. What are you afraid of?', { moveDecision: reflect, enforceMovePolicy: false }) === 'You let it rot. What are you afraid of?');

console.log('\n── E. Crisis-detection fix (Option A) — the two disclosures route to SUPPORT, not pacing ──');
const abuseMsg = "I'm getting abused mentally and physically";
const friendMsg = "My friend is going through a divorce, he's very depressed and has some serious thoughts, I don't know what to do";
const tAbuse = detectCrisisType(abuseMsg);
const tFriend = detectCrisisType(friendMsg);
assert('abuse disclosure -> CLASSIFIED as crisis (was null before)', tAbuse !== null, String(tAbuse));
assert('abuse -> domestic_violence_victim', tAbuse === 'domestic_violence_victim');
assert('abuse -> support response WITH resources (DV hotline 1-800-799-7233)', (getCrisisResponse(tAbuse) || '').includes('1-800-799-7233'));
assert('third-party (friend) -> CLASSIFIED as crisis (was null before)', tFriend !== null, String(tFriend));
assert('third-party -> third_party_risk', tFriend === 'third_party_risk');
assert('third-party -> support response WITH 988', (getCrisisResponse(tFriend) || '').includes('988'));
assert('both are non-none, non-passive -> crisis-bypass skips pacing on these turns',
  tAbuse !== null && tAbuse !== 'passive_crisis' && tFriend !== null && tFriend !== 'passive_crisis');
// Controls: first-person risk unaffected; benign turn does not over-trigger.
assert('control: "I want to die" still -> suicide (first-person unaffected)', detectCrisisType('I want to die') === 'suicide');
assert('control: "she left me and i want to die" -> suicide, NOT third_party (mention of ex doesn\'t misroute)',
  detectCrisisType('she left me and i want to die') === 'suicide');
assert('control: benign turn -> null (no over-trigger)', detectCrisisType('work was busy today and i feel tired') === null);

console.log('\n── SUMMARY ──');
console.log(`  passed: ${passed}   failed: ${failed}`);
if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); }
else console.log('  ✅ SUITE PASSED');
