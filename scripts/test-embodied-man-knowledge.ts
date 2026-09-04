/**
 * Embodied Man Knowledge — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-embodied-man-knowledge.ts
 *
 * ╔═ WHAT THESE TESTS PROVE, AND WHAT THEY CANNOT ══════════════════════════╗
 * Same lens as test-listening-knowledge.ts and test-divorce-knowledge.ts: this
 * environment has NO OPENAI_API_KEY, so no test here runs the Composer model.
 *
 *   • Parts A and B are PROMPT-ASSEMBLY tests. They prove the curated
 *     body-history content and the guardrails are ASSEMBLED and REACH the
 *     Composer prompt (via applyEmbodiedManKnowledge → envelope channels →
 *     buildEnvelopeContextSummary). They do NOT prove the model obeys any of it.
 *
 *   • Part C proves the null path: a turn touching no embodied-man area is left
 *     byte-for-byte alone — the wiring cannot leak into neutral conversation.
 *
 *   • Part D proves the guardrail TEXT exists (inventory), not that the model
 *     follows it.
 *
 *   • Part E proves determinism: same input → identical output, no LLM, no DB.
 *
 * Crisis sentinels are deliberately out of scope here: acute crisis turns
 * early-return before the whisperer stage in orchestrator-v2 and never touch
 * this module.
 */

import {
  detectEmbodiedManAreas, buildEmbodiedManNote, applyEmbodiedManKnowledge,
  EMBODIED_MAN_GUARDRAILS, EMBODIED_MAN_AREAS, EMBODIED_MAN_LENS, EMBODIED_MAN_KNOWLEDGE,
  SOURCES, SECTION_MAP, BODY_WORD_MENUS, MEDICAL_REFERRAL_LINE, CLINICAL_VOCABULARY_BLACKLIST,
} from '../src/lib/agent/embodied-man-knowledge';
import { createStateEnvelope, buildEnvelopeContextSummary } from '../src/lib/agents/state-envelope-utils';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function envWith(utterance: string) {
  return createStateEnvelope({ userId: 'u', conversationId: 'c', utterance, conversationHistory: [], userName: null });
}

function main() {
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── A. Body-history content ASSEMBLES into the Composer prompt (PROMPT-ASSEMBLY, not model obedience) ──');

  const env1 = envWith("when she said that i felt it in my chest, like this knot in my stomach. i just froze.");
  const areas1 = detectEmbodiedManAreas(env1.utterance);
  assert('body-locus turn detects body_locus', areas1.includes('body_locus'));
  assert('freeze turn detects body_impulse', areas1.includes('body_impulse'));
  applyEmbodiedManKnowledge(env1);
  assert('embodied_man appears in invoked', env1.domain_whisperers.invoked.includes('embodied_man'));
  assert('note lands in context_notes', env1.domain_whisperers.context_notes.some(n => n.includes('EMBODIED MAN')));
  assert('where-before-why guidance in the note', env1.domain_whisperers.context_notes.some(n => n.includes('Where comes before why')));
  assert('lens lands in frameworks_applied', env1.domain_whisperers.frameworks_applied.includes('body_locus_before_meaning'));
  assert('all guardrails ride as landmines', EMBODIED_MAN_GUARDRAILS.every(g => env1.domain_whisperers.landmines.includes(g)));
  const ctx1 = buildEnvelopeContextSummary(env1);
  assert('reaches Composer context (WHISPERER INTELLIGENCE + LANDMINES rendered)',
    ctx1.includes('WHISPERER INTELLIGENCE') && ctx1.includes('LANDMINES') && ctx1.includes('EMBODIED MAN'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── B. The hard rules assemble: stuck, medical, consent, gated intimacy ──');

  const env2 = envWith("i don't know. it's fine, not a big deal. whatever.");
  applyEmbodiedManKnowledge(env2);
  assert('stuck turn detects stuck_signal', env2.domain_whisperers.frameworks_applied.includes('simpler_not_harder'));
  assert('note carries simpler-not-harder guidance', env2.domain_whisperers.context_notes.some(n => /Simpler, not harder/.test(n)));
  assert('guardrail forbids pushing past "I don\'t know"',
    env2.domain_whisperers.landmines.some(l => /I don\'t know.*valid answer/.test(l)));

  const env3 = envWith("i've had this chest tightness for months and i haven't had it checked. it keeps me up at night.");
  applyEmbodiedManKnowledge(env3);
  assert('symptom turn detects medical_mention', env3.domain_whisperers.frameworks_applied.includes('medical_boundary_refer_once'));
  assert('guardrail limits the medical move to one referral line',
    env3.domain_whisperers.landmines.some(l => /standing referral line, said once/.test(l)));
  assert('guardrail forbids causal body-mind stories',
    env3.domain_whisperers.landmines.some(l => /No causal body-mind narratives/.test(l)));

  const env4 = envWith("can we skip that? i'd rather not talk about it.");
  applyEmbodiedManKnowledge(env4);
  assert('skip turn detects consent_signal', env4.domain_whisperers.frameworks_applied.includes('consent_is_instant'));
  assert('guardrail closes a narrowed topic instantly',
    env4.domain_whisperers.landmines.some(l => /closed instantly and stays closed/.test(l)));

  const env5 = envWith("there's no sex in my marriage anymore and i feel ashamed of my body.");
  applyEmbodiedManKnowledge(env5);
  assert('intimacy turn detects touch_intimacy', env5.domain_whisperers.frameworks_applied.includes('gated_intimacy_topics'));
  assert('intimacy note carries the section gates', env5.domain_whisperers.context_notes.some(n => /Section 7/.test(n) && /reconfirm/.test(n)));
  assert('guardrail forbids graphic detail',
    env5.domain_whisperers.landmines.some(l => /never ask for description of sexual activity, injury, or illness in graphic detail/.test(l)));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── C. Null path: a neutral turn is left byte-for-byte alone ──');

  const env6 = envWith('what time is the game on sunday?');
  const before = JSON.stringify(env6.domain_whisperers);
  applyEmbodiedManKnowledge(env6);
  assert('neutral turn detects no area', detectEmbodiedManAreas(env6.utterance).length === 0);
  assert('domain_whisperers untouched on a neutral turn', JSON.stringify(env6.domain_whisperers) === before);
  assert('buildEmbodiedManNote returns null on no areas', buildEmbodiedManNote([]) === null);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── D. Guardrail + corpus inventory ──');

  assert('every area has knowledge', EMBODIED_MAN_AREAS.every(a => EMBODIED_MAN_KNOWLEDGE.some(k => k.area === a)));
  assert('every area has a lens', EMBODIED_MAN_AREAS.every(a => typeof EMBODIED_MAN_LENS[a] === 'string' && EMBODIED_MAN_LENS[a].length > 0));
  assert('every knowledge entry has provenance with null reviewer (launch blocker)',
    EMBODIED_MAN_KNOWLEDGE.every(k => k.provenance.reviewed_by === null && k.provenance.reviewed_at === null));
  assert('all three sources recorded', Object.keys(SOURCES).length === 3);
  assert('section map has all 12 sections', SECTION_MAP.length === 12 && SECTION_MAP[11].section === 12);
  assert('gated sections carry gates (2, 5, 7, 12)',
    [2, 5, 7, 12].every(n => SECTION_MAP.find(s => s.section === n)?.gate != null));
  assert('body-word menus cover the five host prompts',
    ['where', 'what_it_feels_like', 'what_changed', 'what_body_wanted', 'simple_feelings'].every(m => (BODY_WORD_MENUS[m] ?? []).length > 0));
  assert('referral line is the spec line (refer once, his choice)',
    /worth getting looked at/.test(MEDICAL_REFERRAL_LINE) && /keep going here, or stop/.test(MEDICAL_REFERRAL_LINE));
  assert('blacklist carries the spec terms',
    ['trauma', 'dissociation', 'somatic', 'nervous system', 'triggered', 'window of tolerance', 'attachment style']
      .every(t => CLINICAL_VOCABULARY_BLACKLIST.includes(t)));
  assert('guardrails forbid interpretation, diagnosis, and clinical vocabulary',
    EMBODIED_MAN_GUARDRAILS.some(g => /Never interpret his body/.test(g)) &&
    EMBODIED_MAN_GUARDRAILS.some(g => /Never diagnose or prognose/.test(g)) &&
    EMBODIED_MAN_GUARDRAILS.some(g => /Never introduce clinical vocabulary/.test(g)));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── E. Determinism: same input → identical output ──');

  const msg = "i froze. i don't know what i felt. it's fine.";
  const a = buildEmbodiedManNote(detectEmbodiedManAreas(msg));
  const b = buildEmbodiedManNote(detectEmbodiedManAreas(msg));
  assert('identical note on identical input', a === b && a !== null);

  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
