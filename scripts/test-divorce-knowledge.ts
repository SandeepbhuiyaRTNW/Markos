/**
 * Divorce Domain Knowledge — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-divorce-knowledge.ts
 *
 * ╔═ WHAT THESE TESTS PROVE, AND WHAT THEY CANNOT ══════════════════════════╗
 * This environment has NO OPENAI_API_KEY, so no test here runs the Composer model.
 * Read every assertion through that lens:
 *
 *   • Parts A, C, D are PROMPT-ASSEMBLY tests. They prove the curated orientation
 *     content, the disclaimer, the escalation targets, and the hard red lines are
 *     ASSEMBLED and REACH the Composer prompt (via the whisperer output and
 *     buildEnvelopeContextSummary). They do NOT prove the model obeys any of it.
 *     A green Part A means "Marcus is TOLD to orient-not-advise," not "Marcus does."
 *
 *   • Part B is the ONLY genuinely CODE-ENFORCED red line. checkBoundary() is a
 *     pure function that scans the FINAL text and flags legal-advice phrasings;
 *     the composer turns a flag into a forced recompose. This catches an actual
 *     legal-advice slip in the output — but only phrasings the patterns match,
 *     and the composer's recompose budget is capped (MAX_REGENS), so it reduces
 *     the rate, it does not guarantee zero. It is detection, not proof of a clean
 *     model.
 *
 * So: NO test here should be read as "catches legal-advice slips." Part B catches
 * the ENUMERATED phrasings in the output; everything else only checks that the
 * guardrail TEXT was assembled into the prompt.
 */

import {
  detectKnowledgeAreas, buildOrientationNote, DIVORCE_DISCLAIMER,
  DIVORCE_KNOWLEDGE_RED_LINES, PROCESS_STAGES, LEGAL_TERMS, STAGE_EMOTION_MAP,
} from '../src/lib/whisperers/divorce-knowledge';
import { runDivorceWhisperer, DIVORCE_RED_LINES } from '../src/lib/whisperers/divorce';
import { checkBoundary, getBoundaryOverridePrompt } from '../src/lib/sentinels/boundary';
import { createStateEnvelope, buildEnvelopeContextSummary } from '../src/lib/agents/state-envelope-utils';
import type { StateEnvelope } from '../src/lib/agents/state-envelope';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function envWith(utterance: string): StateEnvelope {
  const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance, conversationHistory: [], userName: null });
  env.assessment.arena = { weights: { divorce: 0.9 }, primary: 'divorce' };
  return env;
}

/** Render the whisperer output onto an envelope and return the Composer context string. */
function composerContextFor(w: Awaited<ReturnType<typeof runDivorceWhisperer>>, utterance: string): string {
  const env = envWith(utterance);
  env.domain_whisperers.context_notes.push(...(w.context_notes ? [w.context_notes] : []));
  env.domain_whisperers.frameworks_applied.push(...w.frameworks_applied);
  env.domain_whisperers.landmines.push(...w.landmines);
  return buildEnvelopeContextSummary(env);
}

async function main() {
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── A. Curated content ASSEMBLES into the Composer prompt (PROMPT-ASSEMBLY, not model obedience) ──');

  const proc = await runDivorceWhisperer(envWith('okay so what happens now? how does the divorce process even work'));
  assert('process: process_orienting lens surfaces', proc.frameworks_applied.includes('process_orienting'));
  assert('process: orientation note carries the stage arc', proc.context_notes.includes('PROCESS') && proc.context_notes.includes(PROCESS_STAGES[0].stage));
  assert('process: disclaimer is in the note, in Marcus voice', proc.context_notes.includes(DIVORCE_DISCLAIMER));
  assert('process: routes to a family-law attorney', /family-law attorney/i.test(proc.context_notes));
  assert('process: hard red lines ride along as landmines', DIVORCE_KNOWLEDGE_RED_LINES.every(r => proc.landmines.includes(r)));
  assert('process: reaches the Composer context (WHISPERER INTELLIGENCE + LANDMINES rendered)',
    (() => { const c = composerContextFor(proc, 'what happens now'); return c.includes('WHISPERER INTELLIGENCE') && c.includes('LANDMINES') && c.includes('DIVORCE ORIENTATION'); })());

  const legal = await runDivorceWhisperer(envWith('what is discovery? and what does petitioner mean'));
  assert('legal: legal_literacy_orienting lens surfaces', legal.frameworks_applied.includes('legal_literacy_orienting'));
  assert('legal: defines the terms plainly', legal.context_notes.includes('LEGAL LITERACY') && legal.context_notes.includes(LEGAL_TERMS[0].term));
  assert('legal: definitions only — note forbids saying what he will get', /never what he will get/i.test(legal.context_notes));

  const cop = await runDivorceWhisperer(envWith('how do I not wreck my kids through all this'));
  assert('co-parenting: co_parenting_grounding lens surfaces', cop.frameworks_applied.includes('co_parenting_grounding'));
  assert('co-parenting: conflict-is-the-harm-driver content present', /conflict/i.test(cop.context_notes));
  assert('co-parenting: never-mediate guardrail present', /never mediate/i.test(cop.context_notes));

  const fin = await runDivorceWhisperer(envWith('what should I do about the house and all our money'));
  assert('financial: financial_grounding lens surfaces', fin.frameworks_applied.includes('financial_grounding'));
  assert('financial: routes real decisions to a CDFA / advisor', /CDFA|financial advisor/i.test(fin.context_notes));

  assert('emotional stage-map is available and maps Fisher blocks to stages',
    buildOrientationNote(['emotional']).includes('EMOTIONAL STAGE-MAP') && STAGE_EMOTION_MAP.length > 0);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── B. Boundary sentinel legal-advice detector (GENUINELY CODE-ENFORCED on the OUTPUT) ──');
  console.log('   (checkBoundary is a pure fn on the final text; a flag forces a composer recompose.');
  console.log('    It enforces the ENUMERATED phrasings only, and the recompose budget is capped.)');

  const RED_LINE_OUTPUTS: Array<[string, string]> = [
    ['directs him to file first', 'Honestly, you should file first before she does.'],
    ['predicts custody outcome', "With how involved you are, you'll get primary custody for sure."],
    ['predicts the house', "You'll keep the house, that's how these usually go."],
    ['custody strategy', 'Here is how to win full custody: document everything she does wrong.'],
    ['jurisdiction claim', 'In California you get half the assets no matter what.'],
    ['deserve estimate', 'You deserve the house and half his pension after all those years.'],
    ['should-I-divorce verdict', 'Yes, you should divorce her. It is time.'],
  ];
  for (const [label, text] of RED_LINE_OUTPUTS) {
    const r = checkBoundary(text);
    assert(`FLAGS: ${label}`, r.legal_advice === true && r.passed === false, `violations=${JSON.stringify(r.violations)}`);
  }
  // The override actually steers a rewrite toward orient-not-advise.
  assert('legal-advice override tells the model to orient, not advise',
    /orient|generally|do NOT tell him to file/i.test(getBoundaryOverridePrompt(checkBoundary('you should file first'))));

  const SAFE_OUTPUTS: Array<[string, string]> = [
    ['general process orientation', 'Generally, discovery is when both sides exchange financial documents. Your state may differ, and that is a lawyer question.'],
    ['the disclaimer itself', DIVORCE_DISCLAIMER],
    ['plain term definition', 'Legal custody is who makes the big decisions; physical custody is where the kids live day to day.'],
    ['emotional, non-legal "deserve"', 'You deserve better than the way this has felt.'],
  ];
  for (const [label, text] of SAFE_OUTPUTS) {
    const r = checkBoundary(text);
    assert(`does NOT false-flag: ${label}`, r.legal_advice === false, `violations=${JSON.stringify(r.violations)}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── C. Red-line inventory (the guardrail TEXT exists; not that the model follows it) ──');
  const redlineBlob = DIVORCE_RED_LINES.join(' | ').toLowerCase();
  assert('red lines include custody strategy', /custody strategy/.test(redlineBlob));
  assert('red lines include filing / whether-to-divorce decisions', /filing decisions|whether to divorce/.test(redlineBlob));
  assert('red lines forbid jurisdiction-specific claims', /jurisdiction-specific/.test(redlineBlob));
  assert('red lines forbid drafting legal documents', /draft or critique legal documents/.test(redlineBlob));
  assert('red lines forbid "deserves" estimates', /deserves/.test(redlineBlob));
  assert('red lines forbid mediating the couple', /mediate between the couple/.test(redlineBlob));
  assert('emotional-support red lines preserved (no clinical diagnosis)', /never diagnose depression/.test(redlineBlob));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── D. No leak: orientation content stays OUT of a purely emotional turn ──');
  assert('empty message triggers no area', detectKnowledgeAreas('').length === 0);
  assert('pure grief triggers no area', detectKnowledgeAreas('I feel like I failed at everything and I cannot stop crying').length === 0);
  const emo = await runDivorceWhisperer(envWith('I feel like I failed at everything and I cannot stop crying'));
  assert('no orientation lens on a purely emotional turn',
    !emo.frameworks_applied.some(f => /orienting|grounding|stage_mapping/.test(f)));
  assert('no knowledge landmines on a purely emotional turn',
    !emo.landmines.some(l => DIVORCE_KNOWLEDGE_RED_LINES.includes(l)));
  assert('emotional whisperer still runs its clinical lenses (unchanged behavior)', emo.frameworks_applied.length > 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
