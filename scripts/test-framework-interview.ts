/**
 * Framework interview machinery — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-framework-interview.ts
 * Exits 1 on any failure.
 *
 * What these tests prove: the framework interview state machine (phases,
 * consent, in-order answer collection, skips, resumable sittings, completion,
 * re-run reset) transitions exactly as designed, and the Composer note hands
 * over the current question verbatim with the serious-interviewer posture.
 * What they cannot prove: that the model obeys the note (same lens as the
 * other knowledge-module suites).
 *
 * The production instrument (src/lib/interview/framework/questions.ts) is
 * EMPTY until the author's question set lands, so these tests run against a
 * 3-question fixture passed explicitly — the same list the API would read.
 */

import {
  EMPTY_FRAMEWORK_STATE,
  beginFramework, grantFrameworkConsent, recordFrameworkAnswer, skipFrameworkQuestion,
  pauseFramework, resumeFramework, nextQuestion, frameworkProgress, buildFrameworkNote,
  type FrameworkInterviewState,
} from '../src/lib/interview/framework/session';
import { FRAMEWORK_QUESTIONS, frameworkInterviewAvailable, type FrameworkQuestion } from '../src/lib/interview/framework/questions';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok — ${name}`); }
  else { failed++; console.error(`  FAIL — ${name}`); }
}
const T0 = '2026-09-22T12:00:00.000Z';
const T1 = '2026-09-22T12:05:00.000Z';
const T2 = '2026-09-22T12:10:00.000Z';
const T3 = '2026-09-23T09:00:00.000Z';
const T4 = '2026-09-23T09:05:00.000Z';

const FIXTURE: readonly FrameworkQuestion[] = [
  { id: 'q001', text: 'Who were you before anyone told you who to be?', theme: 'origins', heavy: false },
  { id: 'q002', text: 'What are you still punishing yourself for?', theme: 'weight', heavy: true, follow_up: 'What would it take to set that down?' },
  { id: 'q003', text: 'What do you want to be true a year from now?', theme: 'direction', heavy: false },
];

const fresh = (): FrameworkInterviewState => ({ ...EMPTY_FRAMEWORK_STATE, answers: [], skipped: [], sittings: [] });

console.log('A. Availability gate');
check('production instrument is empty until authored', FRAMEWORK_QUESTIONS.length === 0);
check('interview unavailable while instrument empty', frameworkInterviewAvailable() === false);

console.log('B. Begin and consent');
let s = fresh();
check('begin: not_started -> awaiting_consent', beginFramework(s, T0).phase === 'awaiting_consent');
check('consent before begin is a no-op', grantFrameworkConsent(s, T0) === s);
s = beginFramework(s, T0);
check('double begin is a no-op while awaiting consent', beginFramework(s, T1) === s);
s = grantFrameworkConsent(s, T1);
check('consent: awaiting_consent -> in_progress, sitting 1 open', s.phase === 'in_progress' && s.sittings.length === 1 && s.sittings[0].ended_at === null);

console.log('C. Answer collection, in order');
check('next question is q001', nextQuestion(s, FIXTURE)?.id === 'q001');
check('answer before consent never recorded', recordFrameworkAnswer(fresh(), 'x', T0, FIXTURE).answers.length === 0);
check('blank answer is a no-op', recordFrameworkAnswer(s, '   ', T2, FIXTURE) === s);
s = recordFrameworkAnswer(s, '  a quiet kid  ', T2, FIXTURE);
check('answer recorded, trimmed, against q001', s.answers.length === 1 && s.answers[0].question_id === 'q001' && s.answers[0].answer_text === 'a quiet kid');
check('answer snapshots the question text', s.answers[0].question_text === FIXTURE[0].text);
check('answer tagged to sitting 1', s.answers[0].sitting === 1);
check('sitting answer count bumped', s.sittings[0].answered === 1);
check('next question is now q002', nextQuestion(s, FIXTURE)?.id === 'q002');
check('progress: 1 answered, 2 remaining', (() => { const p = frameworkProgress(s, FIXTURE); return p.answered === 1 && p.remaining === 2 && p.total === 3; })());

console.log('D. Skip (the heavy one)');
s = skipFrameworkQuestion(s, T3, FIXTURE);
check('skip records the id, asks it no more', s.skipped.includes('q002') && nextQuestion(s, FIXTURE)?.id === 'q003');
check('skipped question is not in answers', s.answers.every((a) => a.question_id !== 'q002'));

console.log('E. Pause and resume across days');
s = pauseFramework(s, T3);
check('pause closes the sitting', s.phase === 'paused' && s.sittings[0].ended_at === T3);
check('answer while paused is a no-op', recordFrameworkAnswer(s, 'x', T4, FIXTURE).answers.length === 1);
check('note is null while paused', buildFrameworkNote(s, FIXTURE) === null);
s = resumeFramework(s, T4);
check('resume opens sitting 2 at the same question', s.phase === 'in_progress' && s.sittings.length === 2 && nextQuestion(s, FIXTURE)?.id === 'q003');

console.log('F. Completion');
s = recordFrameworkAnswer(s, 'at peace, employed, honest', T4, FIXTURE);
check('last answer completes the run', s.phase === 'completed');
check('completion closes sitting 2', s.sittings[1].ended_at === T4);
check('answer tagged to sitting 2', s.answers[1].sitting === 2);
check('progress: 2 answered, 1 skipped, 0 remaining', (() => { const p = frameworkProgress(s, FIXTURE); return p.answered === 2 && p.skipped === 1 && p.remaining === 0; })());
check('no next question after completion', nextQuestion(s, FIXTURE) === null);

console.log('G. Re-run resets clean');
const rerun = beginFramework(s, '2026-09-24T10:00:00.000Z');
check('begin after completed -> awaiting_consent, answers cleared', rerun.phase === 'awaiting_consent' && rerun.answers.length === 0 && rerun.skipped.length === 0 && rerun.sittings.length === 0);

console.log('H. Composer note');
const mid = recordFrameworkAnswer(grantFrameworkConsent(beginFramework(fresh(), T0), T1), 'a quiet kid', T2, FIXTURE);
const note = buildFrameworkNote(mid, FIXTURE) ?? '';
check('note carries the current question verbatim', note.includes('"What are you still punishing yourself for?"'));
check('note instructs asking as written (comparability)', /as written/i.test(note) && /same question the same way/i.test(note));
check('note sets the interviewer posture', /serious, unhurried, plain/.test(note) && /not to counsel/i.test(note));
check('note bars invented questions', /never invent questions/i.test(note));
check('heavy question gets the explicit out', /skip any question/i.test(note));
check('note includes the one permitted follow-up verbatim', note.includes('What would it take to set that down?'));
const lightNote = buildFrameworkNote(recordFrameworkAnswer(mid, 'x', T3, FIXTURE), FIXTURE) ?? '';
check('non-heavy question carries no heavy out-line', !/This question is a heavy one/.test(lightNote));
check('note is null when not in progress', buildFrameworkNote(fresh(), FIXTURE) === null);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
