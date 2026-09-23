/**
 * Embodied Man interview question content — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-embodied-questions.ts
 * Exits 1 on any failure.
 *
 * What these tests prove: the question content (embodied-questions.ts) covers
 * all 12 sections in order and lines up with the session machinery; the
 * per-turn note carries the current section's main questions, the right gate
 * behavior (Section 2 sub-block, Section 7 consent check first), the medical
 * referral line exactly once, and no clinical vocabulary introduced by the
 * section content; and the note renders on every turn outside the whisperer
 * coaching cap and the move-policy toggle. What they cannot prove: that the
 * model obeys the note (same lens as the other knowledge-module suites).
 */

import {
  EMBODIED_SECTIONS, BEFORE_RECORDING, CLINICAL_BLACKLIST, MEDICAL_REFERRAL_LINE,
  SECTION_7_CONSENT_CHECK, buildSectionContentLines, sectionContent, type MainQuestion,
} from '../src/lib/interview/embodied-questions';
import {
  EMPTY_INTERVIEW_STATE, INTERVIEW_SECTIONS, beginInterview, grantConsent, advanceSection,
  acceptGate, buildInterviewNote, type InterviewState,
} from '../src/lib/interview/session';
import { createStateEnvelope, buildEnvelopeContextSummary } from '../src/lib/agents/state-envelope-utils';

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok — ${name}`); }
  else { failed++; console.error(`  FAIL — ${name}`); }
}
const T0 = '2026-09-22T12:00:00.000Z';

const allMains = (n: number): MainQuestion[] => {
  const c = sectionContent(n)!;
  return [...c.main, ...(c.sub_blocks ?? []).flatMap((b) => b.main)];
};

console.log('A. Coverage');
check('12 sections, numbered 1..12 in order', EMBODIED_SECTIONS.length === 12 && EMBODIED_SECTIONS.every((s, i) => s.section === i + 1));
check('content sections line up with the session machinery sections', INTERVIEW_SECTIONS.every((s) => sectionContent(s.section) !== null));
check('every section has at least one main question', EMBODIED_SECTIONS.every((s) => allMains(s.section).length > 0));
const mainCount = EMBODIED_SECTIONS.reduce((n, s) => n + allMains(s.section).length, 0);
check(`main-question count is in the spec's ~60 range plus the sequence/letter prompts (got ${mainCount})`, mainCount >= 55 && mainCount <= 95);
check('three Before Recording boundary questions', BEFORE_RECORDING.length === 3);
check('no empty or duplicate question text', (() => {
  const texts = EMBODIED_SECTIONS.flatMap((s) => [...allMains(s.section).map((q) => q.text), ...s.follow_ups, ...(s.sub_blocks ?? []).flatMap((b) => b.follow_ups ?? [])]);
  return texts.every((t) => t.trim().length > 0) && new Set(texts).size === texts.length;
})());

console.log('B. Gates');
const gatedBlocks = EMBODIED_SECTIONS.flatMap((s) => (s.sub_blocks ?? []).filter((b) => b.gated).map(() => s.section));
check('the only permission-gated sub-block is the Section 2 touch/sexuality block', gatedBlocks.join(',') === '2');
const s2 = buildSectionContentLines(2).join('\n');
check('Section 2 note marks the sexuality block as yes-only', s2.includes('ONLY if he plainly said yes to touch/sexuality'));
const s7gate = buildSectionContentLines(7, { gatePending: true });
check('Section 7 with gate live: consent check is the first line, verbatim', s7gate[0].includes(SECTION_7_CONSENT_CHECK));
check('Section 7 with gate accepted: no consent-check line', !buildSectionContentLines(7).join('\n').includes(SECTION_7_CONSENT_CHECK));

console.log('C. Composer note per section');
function stateAt(section: number): InterviewState {
  let s = grantConsent(beginInterview({ ...EMPTY_INTERVIEW_STATE }, T0), T0);
  while (s.current_section < section) {
    s = s.phase === 'gate_pending' ? acceptGate(s, T0) : advanceSection(s, T0);
  }
  return s.phase === 'gate_pending' ? acceptGate(s, T0) : s;
}
let maxLen = 0;
for (let n = 1; n <= 12; n++) {
  const note = buildInterviewNote(stateAt(n))!;
  maxLen = Math.max(maxLen, note.length);
  check(`Section ${n}: note carries every main question verbatim`, allMains(n).every((q) => note.includes(q.text)));
  check(`Section ${n}: medical referral line exactly once`, note.split(MEDICAL_REFERRAL_LINE).length === 2);
  const content = buildSectionContentLines(n).join('\n').toLowerCase();
  check(`Section ${n}: section content introduces no clinical vocabulary`, CLINICAL_BLACKLIST.every((w) => !new RegExp(`\\b${w.replace('/', '\\/')}\\b`).test(content)));
}
check(`longest note stays reasonable (${maxLen} chars < 6500)`, maxLen < 6500);
check('boundary questions only on the very first sitting at Section 1', buildInterviewNote(stateAt(1))!.includes('B1.') && !buildInterviewNote(stateAt(2))!.includes('B1.'));

console.log('D. Rendering outside the coaching cap and the move-policy toggle');
const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance: 'hello', conversationHistory: [] });
const note = buildInterviewNote(stateAt(4))!;
env.domain_whisperers.session_notes = [note];
env.domain_whisperers.landmines.push('x'.repeat(6000)); // blow the coaching budget on purpose
env.domain_whisperers.context_notes.push('COACHING NOTE');
const onTurn = buildEnvelopeContextSummary(env);
const offTurn = buildEnvelopeContextSummary(env, { includeWhispererContext: false, includeQuestionCandidates: false });
check('session note renders in full even when landmines exceed the cap', onTurn.includes(note));
check('session note renders when the move policy hides whisperer output', offTurn.includes(note) && !offTurn.includes('COACHING NOTE'));
const plain = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance: 'hello', conversationHistory: [] });
check('no session note -> no STRUCTURED SESSION block (ordinary turns unchanged)', !buildEnvelopeContextSummary(plain).includes('STRUCTURED SESSION'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
