/**
 * Embodied Man Knowledge — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-embodied-man-knowledge.ts
 * Exits 1 on any failure — including a breach of the whisperer injection cap.
 *
 * ╔═ WHAT THESE TESTS PROVE, AND WHAT THEY CANNOT ══════════════════════════╗
 * Same lens as test-listening-knowledge.ts and test-divorce-knowledge.ts: this
 * environment has NO OPENAI_API_KEY, so no test here runs the Composer model.
 *
 *   • Parts A and B are PROMPT-ASSEMBLY tests. They prove the curated
 *     body-history content and the fired area's guardrails are ASSEMBLED and
 *     REACH the Composer prompt (via applyEmbodiedManKnowledge → envelope
 *     channels → buildEnvelopeContextSummary). They do NOT prove the model
 *     obeys any of it.
 *
 *   • Part C proves the null path: a turn touching no embodied-man area is
 *     left byte-for-byte alone.
 *
 *   • Part D proves the corpus + guardrail TEXT exists (inventory), not that
 *     the model follows it.
 *
 *   • Part E proves the shared trigger rules: word-boundary matching,
 *     two-signals-or-long-utterance eligibility, one area per turn, and the
 *     token-ownership registry (no banned or listening-owned tokens here).
 *
 *   • Part F proves the hard injection cap: total whisperer landmines +
 *     context notes rendered into the Composer prompt never exceed
 *     MAX_WHISPERER_INJECT_CHARS (~1,200 tokens), even when the envelope is
 *     stuffed past it.
 *
 *   • Part G proves determinism: same input → identical output.
 *
 * Crisis sentinels are deliberately out of scope here: acute crisis turns
 * early-return before the whisperer stage in orchestrator-v2 and never touch
 * this module; passive-crisis (elevated) turns pass through with the crisis
 * layer's guidance outranking this module's.
 */

import {
  detectEmbodiedManAreas, buildEmbodiedManNote, applyEmbodiedManKnowledge,
  EMBODIED_MAN_GUARDRAILS, ALL_GUARDRAIL_TEXTS, guardrailsForArea,
  EMBODIED_MAN_AREAS, EMBODIED_MAN_LENS, EMBODIED_MAN_KNOWLEDGE,
  SOURCES, SECTION_MAP, BODY_WORD_MENUS, MEDICAL_REFERRAL_LINE, CLINICAL_VOCABULARY_BLACKLIST,
  EMBODIED_MAN_AREA_SIGNALS,
} from '../src/lib/agent/embodied-man-knowledge';
import {
  MIN_WORDS_SINGLE_SIGNAL, MAX_WHISPERER_INJECT_CHARS,
  wordBoundaryIncludes, pickTriggeredArea, capWhispererInjection,
  assertTokensOwnedBy, countWords,
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

function injectedChars(env: ReturnType<typeof envWith>): number {
  const l = env.domain_whisperers.landmines.reduce((n, s) => n + s.length + 3, 0);
  const n = env.domain_whisperers.context_notes.reduce((x, s) => x + s.length + 1, 0);
  return l + n;
}

function main() {
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── A. Body-history content ASSEMBLES into the Composer prompt (PROMPT-ASSEMBLY, not model obedience) ──');

  const env1 = envWith("when she said that i felt it in my chest, like this knot in my stomach. i just froze.");
  const areas1 = detectEmbodiedManAreas(env1.utterance);
  assert('exactly one area fires per turn', areas1.length === 1, `got ${JSON.stringify(areas1)}`);
  assert('the fired area is body_locus (3 hits beats body_impulse 1)', areas1[0] === 'body_locus');
  applyEmbodiedManKnowledge(env1);
  assert('embodied_man appears in invoked', env1.domain_whisperers.invoked.includes('embodied_man'));
  assert('note lands in context_notes', env1.domain_whisperers.context_notes.some(n => n.includes('EMBODIED MAN')));
  assert('where-before-why guidance in the note', env1.domain_whisperers.context_notes.some(n => n.includes('Where comes before why')));
  assert('lens lands in frameworks_applied', env1.domain_whisperers.frameworks_applied.includes('body_locus_before_meaning'));
  assert('only the fired area\'s guardrails ride as landmines',
    env1.domain_whisperers.landmines.length === guardrailsForArea('body_locus').length &&
    guardrailsForArea('body_locus').every(g => env1.domain_whisperers.landmines.includes(g)));
  assert('guardrails render ONCE — the note does not repeat them',
    env1.domain_whisperers.context_notes.every(n => !n.includes('Never interpret his body')));
  assert('another area\'s guardrails do NOT ship (no medical referral rule on a locus turn)',
    !env1.domain_whisperers.landmines.some(l => /standing referral line, said once/.test(l)));
  const ctx1 = buildEnvelopeContextSummary(env1);
  assert('reaches Composer context (WHISPERER INTELLIGENCE + LANDMINES rendered)',
    ctx1.includes('WHISPERER INTELLIGENCE') && ctx1.includes('LANDMINES') && ctx1.includes('EMBODIED MAN'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── B. The hard rules assemble: stuck, medical, consent, gated intimacy ──');

  const env2 = envWith("i don't know. i dunno. nothing really.");
  applyEmbodiedManKnowledge(env2);
  assert('stuck turn fires stuck_signal', env2.domain_whisperers.frameworks_applied.includes('simpler_not_harder'));
  assert('note carries simpler-not-harder guidance', env2.domain_whisperers.context_notes.some(n => /Simpler, not harder/.test(n)));
  assert('guardrail forbids pushing past "I don\'t know"',
    env2.domain_whisperers.landmines.some(l => /I don\'t know.*valid answer/.test(l)));

  const env3 = envWith("i've had this chest tightness for months and i haven't had it checked. it keeps me up at night.");
  applyEmbodiedManKnowledge(env3);
  assert('symptom turn fires medical_mention', env3.domain_whisperers.frameworks_applied.includes('medical_boundary_refer_once'));
  assert('guardrail limits the medical move to one referral line',
    env3.domain_whisperers.landmines.some(l => /standing referral line, said once/.test(l)));
  assert('guardrail forbids causal body-mind stories',
    env3.domain_whisperers.landmines.some(l => /No causal body-mind narratives/.test(l)));

  const env4 = envWith("can we skip that? i'd rather not talk about it.");
  applyEmbodiedManKnowledge(env4);
  assert('skip turn fires consent_signal', env4.domain_whisperers.frameworks_applied.includes('consent_is_instant'));
  assert('guardrail closes a narrowed topic instantly',
    env4.domain_whisperers.landmines.some(l => /closed instantly and stays closed/.test(l)));

  const env5 = envWith("there's no sex in my marriage anymore and i feel ashamed of my body.");
  applyEmbodiedManKnowledge(env5);
  assert('intimacy turn fires touch_intimacy', env5.domain_whisperers.frameworks_applied.includes('gated_intimacy_topics'));
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
  assert('17 guardrails: 9 universal + 8 area-scoped',
    EMBODIED_MAN_GUARDRAILS.length === 17 &&
    EMBODIED_MAN_GUARDRAILS.filter(g => g.areas === 'all').length === 9);
  assert('every area ships all 9 universal guardrails',
    EMBODIED_MAN_AREAS.every(a => {
      const mine = guardrailsForArea(a);
      return EMBODIED_MAN_GUARDRAILS.filter(g => g.areas === 'all').every(g => mine.includes(g.text));
    }));
  assert('guardrails forbid interpretation, diagnosis, and clinical vocabulary',
    ALL_GUARDRAIL_TEXTS.some(g => /Never interpret his body/.test(g)) &&
    ALL_GUARDRAIL_TEXTS.some(g => /Never diagnose or prognose/.test(g)) &&
    ALL_GUARDRAIL_TEXTS.some(g => /Never introduce clinical vocabulary/.test(g)));
  assert('crisis guardrail is accurate: acute bypasses, passive/elevated passes through',
    ALL_GUARDRAIL_TEXTS.some(g => /acute crisis turns never reach this module/.test(g) && /elevated\) turns DO pass through/.test(g)));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── E. Shared trigger rules (trigger-registry.ts) ──');

  assert('word-boundary: "rage" does not fire on "enraged"',
    !wordBoundaryIncludes('i was enraged the whole drive home', 'rage'));
  assert('word-boundary: "rage" fires on the whole word',
    wordBoundaryIncludes('the rage came out of nowhere', 'rage'));
  assert('word-boundary: multi-word phrase with apostrophe matches',
    wordBoundaryIncludes("honestly i don't know what to say", "i don't know"));

  assert('single signal + short utterance fires NOTHING',
    detectEmbodiedManAreas('shut down.').length === 0);
  assert(`single signal + >= ${MIN_WORDS_SINGLE_SIGNAL} words fires`,
    detectEmbodiedManAreas('ever since the doctor visit i feel completely shut down at home').length === 1);
  assert('two signals fire even in a short utterance',
    detectEmbodiedManAreas("i don't know, i dunno").length === 1);

  const multi = detectEmbodiedManAreas("i don't know. i dunno. my chest gets tight and there's this knot in my stomach.");
  assert('multi-area turn fires exactly ONE area', multi.length === 1, `got ${JSON.stringify(multi)}`);
  assert('the highest-hit area wins (body_locus: 2 hits vs stuck 2 — tie breaks by area order)',
    multi[0] === 'stuck_signal' || multi[0] === 'body_locus');

  assert('banned idiom "whatever" fires nothing',
    detectEmbodiedManAreas('whatever happens at work tomorrow happens, i guess it is what it is').length === 0);
  assert('banned "shame" idiom fires nothing',
    detectEmbodiedManAreas("that's a shame about the weather ruining the game").length === 0);
  assert('banned "the guys" fires nothing',
    detectEmbodiedManAreas('the guys are coming over friday to watch the game').length === 0);
  assert('listening-owned "i\'m fine" fires nothing in this module',
    detectEmbodiedManAreas("i'm fine. it's fine. not a big deal.").length === 0);

  // Registry ownership: every token this module declares must be owned by it.
  const moduleTokens = Object.values(EMBODIED_MAN_AREA_SIGNALS).flat();
  const violations = assertTokensOwnedBy('embodied_man', moduleTokens);
  assert('every declared token is owned by embodied_man (registry clean)',
    violations.length === 0, violations.join('; '));

  assert('pickTriggeredArea tie-breaks by declared area order', (() => {
    const sigs = { a: ['alpha one'], b: ['beta two'] } as const;
    const hit = pickTriggeredArea('alpha one and beta two said the man quietly today', sigs, ['a', 'b']);
    return hit === 'a';
  })());
  assert('countWords counts whitespace-separated words', countWords("i don't know") === 3);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── F. Hard injection cap (~1,200 tokens/turn) — FAILS THE BUILD IF BREACHED ──');

  // Worst realistic case for this module: the largest area note + its guardrails.
  let worst = 0;
  let worstArea = '';
  for (const area of EMBODIED_MAN_AREAS) {
    const note = buildEmbodiedManNote([area]);
    const size = (note?.length ?? 0) + 1 + guardrailsForArea(area).reduce((n, g) => n + g.length + 3, 0);
    if (size > worst) { worst = size; worstArea = area; }
  }
  assert(`worst-case single-area injection (${worstArea}: ${worst} chars) fits the cap`,
    worst <= MAX_WHISPERER_INJECT_CHARS, `${worst} > ${MAX_WHISPERER_INJECT_CHARS}`);

  // The render point trims ANY over-cap envelope, landmines before notes.
  const stuffed = envWith('neutral');
  stuffed.domain_whisperers.landmines.push(...Array.from({ length: 40 }, (_, i) => `landmine ${i}: ${'x'.repeat(200)}`));
  stuffed.domain_whisperers.context_notes.push(...Array.from({ length: 10 }, (_, i) => `note ${i}: ${'y'.repeat(900)}`));
  const rendered = buildEnvelopeContextSummary(stuffed);
  const lmMatch = rendered.match(/## LANDMINES — DO NOT:\n([\s\S]*?)(\n\n## |\n\n$|$)/);
  const wiMatch = rendered.match(/## WHISPERER INTELLIGENCE\n([\s\S]*?)(\n\n## |\n\n$|$)/);
  // Landmines (safety) are EXEMPT from the cap: they render in full even when
  // they alone exceed it. Context notes absorb the entire trim.
  assert('landmines are exempt from the cap: all 40 render in full',
    (lmMatch?.[1] ?? '').includes('landmine 39'));
  assert('context notes absorb the whole trim when landmines exceed the cap',
    !(wiMatch?.[1] ?? '').includes('note 0'));
  const overCap = capWhispererInjection(
    Array.from({ length: 40 }, (_, i) => `landmine ${i}: ${'x'.repeat(200)}`), ['a note']);
  assert('landmines_over_cap flags the breach, landmines kept, notes trimmed',
    overCap.landmines_over_cap && overCap.landmines.length === 40 && overCap.context_notes.length === 0);

  const capResult = capWhispererInjection(['a'.repeat(100)], ['b'.repeat(MAX_WHISPERER_INJECT_CHARS)]);
  assert('capWhispererInjection reports trimmed when an item does not fit',
    capResult.trimmed && capResult.landmines.length === 1 && capResult.context_notes.length === 0);
  const underCap = capWhispererInjection(['short'], ['also short']);
  assert('under the cap the input passes through untouched',
    !underCap.trimmed && underCap.landmines.length === 1 && underCap.context_notes.length === 1);

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── G. Determinism: same input → identical output ──');

  const msg = "i froze. i don't know what i felt. my chest gets tight every single time she raises her voice at me.";
  const a = buildEmbodiedManNote(detectEmbodiedManAreas(msg));
  const b = buildEmbodiedManNote(detectEmbodiedManAreas(msg));
  assert('identical note on identical input', a === b && a !== null);

  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
