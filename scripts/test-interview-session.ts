/**
 * Interview session machinery — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-interview-session.ts
 * Exits 1 on any failure.
 *
 * What these tests prove: the interview state machine (phases, consent gate,
 * 12 sections in order, gated sections, resumable sittings) transitions exactly
 * as specced, and the Composer note carries section context WITHOUT question
 * content. What they cannot prove: that the model obeys the note (same lens as
 * the other knowledge-module suites).
 */

import {
  EMPTY_INTERVIEW_STATE, INTERVIEW_SECTIONS, TOTAL_SECTIONS,
  beginInterview, grantConsent, advanceSection, acceptGate, pauseInterview,
  resumeInterview, buildInterviewNote, currentSection, PERMISSION_GATED_SECTIONS,
  type InterviewState,
} from '../src/lib/interview/session';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok — ${name}`); }
  else { failed++; console.error(`  FAIL — ${name}`); }
}
const T0 = '2026-09-07T12:00:00.000Z';
const T1 = '2026-09-07T12:30:00.000Z';
const T2 = '2026-09-08T09:00:00.000Z';

console.log('A. Section map');
check('12 sections, in order', INTERVIEW_SECTIONS.length === 12 && INTERVIEW_SECTIONS.every((s, i) => s.section === i + 1));
check('permission-gated sections are exactly 2, 5, 7 (12 is a conduct gate)', PERMISSION_GATED_SECTIONS.join(',') === '2,5,7');
check('no section carries question content (name + life_stage + gate only)',
  INTERVIEW_SECTIONS.every((s) => Object.keys(s).sort().join(',') === 'gate,life_stage,name,section'));

console.log('B. Begin + consent gate');
let s: InterviewState = { ...EMPTY_INTERVIEW_STATE };
check('starts not_started', s.phase === 'not_started');
check('note is null before the interview starts', buildInterviewNote(s) === null);
check('consent before begin is a no-op', grantConsent(s, T0) === s);
s = beginInterview(s, T0);
check('begin -> awaiting_consent', s.phase === 'awaiting_consent');
check('awaiting consent emits no composer note', buildInterviewNote(s) === null);
check('advance before consent is a no-op', advanceSection(s, T0) === s);
check('pause before consent is a no-op', pauseInterview(s, T0) === s);
s = grantConsent(s, T0);
check('consent -> in_progress at section 1, sitting 1 open', s.phase === 'in_progress' && s.current_section === 1 && s.sittings.length === 1 && s.sittings[0].ended_at === null);

console.log('C. Sections in order + gates');
s = advanceSection(s, T0);
check('advance 1 -> 2 enters gate_pending (section 2 is gated)', s.phase === 'gate_pending' && s.current_section === 2 && s.gate_pending);
check('sections_completed tracks section 1', s.sections_completed.join(',') === '1');
check('advance while gate_pending is a no-op', advanceSection(s, T0) === s);
s = acceptGate(s, T0);
check('accept-gate -> in_progress', s.phase === 'in_progress' && !s.gate_pending);
s = advanceSection(s, T0);
check('advance 2 -> 3 (ungated) stays in_progress', s.phase === 'in_progress' && s.current_section === 3 && !s.gate_pending);

console.log('D. Pause + resume (resumable sittings)');
s = pauseInterview(s, T1);
check('pause closes the sitting and keeps the section', s.phase === 'paused' && s.current_section === 3 && s.sittings[0].ended_at === T1);
check('paused emits no composer note', buildInterviewNote(s) === null);
s = resumeInterview(s, T2);
check('resume opens sitting 2 at the SAME section another day', s.phase === 'in_progress' && s.sittings.length === 2 && s.sittings[1].from_section === 3 && s.current_section === 3);

console.log('E. Completion');
while (s.phase === 'in_progress' || s.phase === 'gate_pending') {
  s = s.phase === 'gate_pending' ? acceptGate(s, T2) : advanceSection(s, T2);
}
check('advancing past section 12 completes the interview', s.phase === 'completed');
check('all 12 sections completed', s.sections_completed.length === TOTAL_SECTIONS);
check('completed emits no composer note', buildInterviewNote(s) === null);
const restarted = beginInterview(s, '2026-09-09T00:00:00.000Z');
check('a completed interview can begin again fresh', restarted.phase === 'awaiting_consent' && restarted.current_section === 1 && restarted.sections_completed.length === 0);

console.log('F. Composer note content');
const mid = resumeInterview(pauseInterview(grantConsent(beginInterview({ ...EMPTY_INTERVIEW_STATE }, T0), T0), T1), T2);
const note = buildInterviewNote(mid);
check('note exists mid-interview', note !== null);
check('note names the current section', !!note && note.includes('Section 1 of 12') && note.includes('Early Childhood'));
check('note bars inventing the interview questions', !!note && note.includes('NOT authored'));
check('note carries no question text (no question marks)', !!note && !note.includes('?'));
check('note marks itself internal / never verbatim', !!note && note.includes('never read verbatim'));

console.log('G. Determinism');
const run = () => {
  let x: InterviewState = { ...EMPTY_INTERVIEW_STATE };
  x = beginInterview(x, T0); x = grantConsent(x, T0); x = advanceSection(x, T0);
  x = acceptGate(x, T0); x = pauseInterview(x, T1); x = resumeInterview(x, T2);
  return JSON.stringify(x);
};
check('same inputs -> identical state', run() === run());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
