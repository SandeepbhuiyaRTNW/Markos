/**
 * Listening, Response & Conversation Knowledge — deterministic tests
 * (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-listening-knowledge.ts
 * Exits 1 on any failure — including a breach of the whisperer injection cap.
 *
 * ╔═ WHAT THESE TESTS PROVE, AND WHAT THEY CANNOT ══════════════════════════╗
 * This environment has NO OPENAI_API_KEY, so no test here runs the Composer
 * model.
 *
 *   • Parts A and B are PROMPT-ASSEMBLY tests. They prove the curated
 *     listening content and the fired area's guardrails are ASSEMBLED and
 *     REACH the Composer prompt. They do NOT prove the model obeys any of it.
 *
 *   • Part C proves the null path: a turn touching no listening area is left
 *     byte-for-byte alone.
 *
 *   • Part D proves the corpus + guardrail TEXT exists (inventory), and that
 *     the divorce areas are gone (the divorce layer owns that terrain).
 *
 *   • Part E proves the shared trigger rules: word-boundary matching,
 *     two-signals-or-long-utterance eligibility, one area per turn, and the
 *     token-ownership registry (no banned, embodied-owned, or divorce-owned
 *     tokens here).
 *
 *   • Part F proves the injection cap: context notes are trimmed to the
 *     budget, and LANDMINES ARE EXEMPT — safety constraints render in full
 *     even when several modules fire on the same turn.
 *
 *   • Part G proves determinism: same input → identical output.
 *
 * Crisis sentinels are deliberately out of scope here: acute crisis turns
 * early-return before the whisperer stage in orchestrator-v2 and never touch
 * this module; passive-crisis (elevated) turns pass through with the crisis
 * layer's guidance outranking this module's.
 */

import {
  detectListeningAreas, buildListeningNote, applyListeningKnowledge,
  RESPONSE_GUARDRAILS, ALL_GUARDRAIL_TEXTS, guardrailsForArea,
  LISTENING_AREAS, LISTENING_LENS, LISTENING_KNOWLEDGE, SOURCES,
  LISTENING_AREA_SIGNALS,
} from '../src/lib/agent/listening-knowledge';
import {
  MIN_WORDS_SINGLE_SIGNAL, MAX_WHISPERER_INJECT_CHARS,
  wordBoundaryIncludes, capWhispererInjection, assertTokensOwnedBy,
} from '../src/lib/agent/trigger-registry';
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
  console.log('\n── A. Listening content ASSEMBLES into the Composer prompt (PROMPT-ASSEMBLY, not model obedience) ──');

  const env1 = envWith("you keep cutting me off and you're not listening. let me finish.");
  const areas1 = detectListeningAreas(env1.utterance);
  assert('exactly one area fires per turn', areas1.length === 1, `got ${JSON.stringify(areas1)}`);
  assert('the fired area is presence (2 hits)', areas1[0] === 'presence');
  applyListeningKnowledge(env1);
  assert('listening appears in invoked', env1.domain_whisperers.invoked.includes('listening'));
  assert('note lands in context_notes', env1.domain_whisperers.context_notes.some(n => n.includes('LISTENING')));
  assert('lens lands in frameworks_applied', env1.domain_whisperers.frameworks_applied.includes('presence_listening'));
  assert('only the fired area\'s guardrails ride as landmines',
    env1.domain_whisperers.landmines.length === guardrailsForArea('presence').length &&
    guardrailsForArea('presence').every(g => env1.domain_whisperers.landmines.includes(g)));
  assert('guardrails render ONCE — the note does not repeat them',
    env1.domain_whisperers.context_notes.every(n => !n.includes('Never interrupt him')));
  assert('another area\'s guardrails do NOT ship (no three-layers rule on a presence turn)',
    !env1.domain_whisperers.landmines.some(l => /three layers/.test(l)));
  const ctx1 = buildEnvelopeContextSummary(env1);
  assert('reaches Composer context (WHISPERER INTELLIGENCE + LANDMINES rendered)',
    ctx1.includes('WHISPERER INTELLIGENCE') && ctx1.includes('LANDMINES') && ctx1.includes('LISTENING'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── B. The hard rules assemble: armor, de-escalation, hard conversations ──');

  const env2 = envWith("not a big deal. i should be able to handle it myself, honestly.");
  applyListeningKnowledge(env2);
  assert('armor turn fires cost_of_talking', env2.domain_whisperers.frameworks_applied.includes('male_disclosure_cost'));
  assert('guardrail forbids naming his reluctance as a problem',
    env2.domain_whisperers.landmines.some(l => /reluctance to talk as a problem/.test(l)));

  const env3 = envWith("i'm so angry i can't calm down. i'm done with this marriage.");
  applyListeningKnowledge(env3);
  assert('escalated turn fires deescalation', env3.domain_whisperers.frameworks_applied.includes('persuasion_cycle_staging'));
  assert('guardrail: anger is not the whole story',
    env3.domain_whisperers.landmines.some(l => /anger as the whole story/.test(l)));

  const env4 = envWith("i have to talk to my ex about the kids and i'm dreading this conversation.");
  applyListeningKnowledge(env4);
  assert('hard-conversation turn fires difficult_conversations', env4.domain_whisperers.frameworks_applied.includes('three_conversations'));
  assert('guardrail: three layers, never assign blame',
    env4.domain_whisperers.landmines.some(l => /three layers/.test(l) && /never assign blame/.test(l)));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── C. Null path: a neutral turn is left byte-for-byte alone ──');

  const env5 = envWith('what time is the game on sunday?');
  const before = JSON.stringify(env5.domain_whisperers);
  applyListeningKnowledge(env5);
  assert('neutral turn detects no area', detectListeningAreas(env5.utterance).length === 0);
  assert('domain_whisperers untouched on a neutral turn', JSON.stringify(env5.domain_whisperers) === before);
  assert('buildListeningNote returns null on no areas', buildListeningNote([]) === null);
  assert('empty message triggers no area', detectListeningAreas('').length === 0);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── D. Guardrail + corpus inventory; divorce terrain is GONE ──');

  assert('15 areas (divorce areas removed)', LISTENING_AREAS.length === 15);
  assert('every area has knowledge', LISTENING_AREAS.every(a => LISTENING_KNOWLEDGE.some(k => k.area === a)));
  assert('every area has a lens', LISTENING_AREAS.every(a => typeof LISTENING_LENS[a] === 'string' && LISTENING_LENS[a].length > 0));
  assert('every knowledge entry has provenance with null reviewer (launch blocker)',
    LISTENING_KNOWLEDGE.every(k => k.provenance.reviewed_by === null && k.provenance.reviewed_at === null));
  assert('16 guardrails: 11 universal + 5 area-scoped',
    RESPONSE_GUARDRAILS.length === 16 &&
    RESPONSE_GUARDRAILS.filter(g => g.areas === 'all').length === 11);
  assert('every area ships all 11 universal guardrails',
    LISTENING_AREAS.every(a => {
      const mine = guardrailsForArea(a);
      return RESPONSE_GUARDRAILS.filter(g => g.areas === 'all').every(g => mine.includes(g.text));
    }));
  assert('crisis guardrail is accurate: acute bypasses, passive/elevated passes through',
    ALL_GUARDRAIL_TEXTS.some(g => /acute crisis turns never reach this module/.test(g) && /elevated\) turns DO pass through/.test(g)));
  assert('divorce areas removed from the type surface',
    !LISTENING_AREAS.includes('divorce_talk_terrain' as never) && !LISTENING_AREAS.includes('six_divorces_at_once' as never));
  assert('divorce-station guardrails removed (dismissal script, declared recovery)',
    !ALL_GUARDRAIL_TEXTS.some(g => /dismissal script/.test(g)) && !ALL_GUARDRAIL_TEXTS.some(g => /declare his recovery/.test(g)));
  assert('divorce turns fire NOTHING here (divorce layer owns them)',
    detectListeningAreas('she filed last week. my divorce lawyer wants the documents. the house is too quiet.').length === 0);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── E. Shared trigger rules (trigger-registry.ts) ──');

  assert('word-boundary: "furiously" is NOT "furious"',
    !wordBoundaryIncludes('he typed furiously all morning', 'furious'));
  assert('word-boundary: whole word fires',
    wordBoundaryIncludes('i am furious about this', 'furious'));

  assert('single signal + short utterance fires NOTHING',
    detectListeningAreas('just listen.').length === 0);
  assert(`single signal + >= ${MIN_WORDS_SINGLE_SIGNAL} words fires`,
    detectListeningAreas('honestly at this point in the conversation i just listen and wait').length === 1);
  assert('two signals fire even in a short utterance',
    detectListeningAreas("you're not listening. let me finish.").length === 1);

  assert('banned idiom "i\'m fine" fires nothing',
    detectListeningAreas("i'm fine. it's fine, really.").length === 0);
  assert('banned filler "what do you think" fires nothing',
    detectListeningAreas('what do you think, does that make sense? you know what i mean?').length === 0);
  assert('banned "practical" fires nothing',
    detectListeningAreas('that is a practical question for the accountant to answer').length === 0);
  assert('embodied-owned "don\'t want to talk about it" fires nothing here',
    detectListeningAreas("i don't want to talk about it, please just drop it now").length === 0);

  const moduleTokens = Object.values(LISTENING_AREA_SIGNALS).flat();
  const violations = assertTokensOwnedBy('listening', moduleTokens);
  assert('every declared token is owned by listening (registry clean)',
    violations.length === 0, violations.join('; '));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── F. Injection cap: notes trim, LANDMINES ARE EXEMPT ──');

  // Worst realistic case for this module: the largest area note + its guardrails.
  let worst = 0;
  let worstArea = '';
  for (const area of LISTENING_AREAS) {
    const note = buildListeningNote([area]);
    const size = (note?.length ?? 0) + 1 + guardrailsForArea(area).reduce((n, g) => n + g.length + 3, 0);
    if (size > worst) { worst = size; worstArea = area; }
  }
  assert(`worst-case single-area injection (${worstArea}: ${worst} chars) fits the cap`,
    worst <= MAX_WHISPERER_INJECT_CHARS, `${worst} > ${MAX_WHISPERER_INJECT_CHARS}`);

  // Multi-module pile-up: landmines render in FULL even past the cap; notes trim.
  const stuffed = envWith('neutral');
  stuffed.domain_whisperers.landmines.push(...Array.from({ length: 40 }, (_, i) => `landmine ${i}: ${'x'.repeat(200)}`));
  stuffed.domain_whisperers.context_notes.push(...Array.from({ length: 10 }, (_, i) => `note ${i}: ${'y'.repeat(900)}`));
  const rendered = buildEnvelopeContextSummary(stuffed);
  assert('ALL 40 landmines render even past the cap (safety is exempt)',
    (rendered.match(/landmine \d+:/g) ?? []).length === 40);
  assert('context notes are trimmed to the remaining budget',
    !rendered.includes('note 9:') && !rendered.includes('WHISPERER INTELLIGENCE'));

  const capResult = capWhispererInjection(['a'.repeat(100)], ['b'.repeat(MAX_WHISPERER_INJECT_CHARS)]);
  assert('capWhispererInjection: note dropped, landmine kept, trimmed flagged',
    capResult.trimmed && capResult.landmines.length === 1 && capResult.context_notes.length === 0);
  const overCap = capWhispererInjection(Array.from({ length: 40 }, () => 'x'.repeat(200)), []);
  assert('landmines_over_cap flags when landmines alone exceed the budget',
    overCap.landmines_over_cap && overCap.landmines.length === 40);
  const underCap = capWhispererInjection(['short'], ['also short']);
  assert('under the cap the input passes through untouched',
    !underCap.trimmed && !underCap.landmines_over_cap && underCap.context_notes.length === 1);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── G. Determinism: same input → identical output ──');

  const msg = "you keep cutting me off. you're not listening, and honestly i feel like nobody hears me at work either.";
  const a = buildListeningNote(detectListeningAreas(msg));
  const b = buildListeningNote(detectListeningAreas(msg));
  assert('identical note on identical input', a === b && a !== null);

  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
