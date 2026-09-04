/**
 * Post-generation re-verify — the fix in PR #20 (fix/post-gen-gates-reverify).
 * Run: npx tsx scripts/test-postgen-reverify.ts
 *
 * Covers the two behaviors PR #20 introduces that no existing suite exercises,
 * driven through a REAL composer turn with a stub model (no OpenAI, no DB):
 *
 *   1. LEGAL ADVICE INTRODUCED BY A CRAFT REWRITE. The first draft is clean at
 *      the boundary but trips the vocab-fidelity gate; the vocab REWRITE contains
 *      legal advice. Because craft rewrites now re-enter the boundary loop with
 *      the same fail-closed legal path, the turn must ship the safe legal-advice
 *      fallback — NOT the advice — and record `legal_advice_fallback`.
 *
 *   2. A CRAFT GATE THAT STILL TRIPS AFTER ITS REWRITE. The stub keeps emitting a
 *      forbidden phrase on every re-roll. The gate must loop to the budget,
 *      re-verifying each draft, then keep the best (still-tripping) draft rather
 *      than ship an unverified one — surfaced via the repeated regen trigger and
 *      the fact that the shipped reply still trips the detector.
 *
 * HONEST LIMIT: this proves the composer's CONTROL FLOW around the gates (re-
 * verify, re-enter boundary, fail closed). It does not prove a real model obeys
 * any override — the stub returns fixed strings, which is exactly the adversarial
 * case (a model that keeps violating).
 */
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import {
  runComposerPipeline,
  buildLegalAdviceFallback,
  type ComposerTestHooks,
} from '../src/lib/agents/orchestrator-v2-composer';
import { checkBoundary } from '../src/lib/sentinels/boundary';
import { detectForbiddenPhrases } from '../src/lib/craft/craft-layer';

const MAX_REGENS = 2; // mirrors the constant inside runComposerPipeline

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

let n = 0;
const queryFn: NonNullable<ComposerTestHooks['queryFn']> = async (sql: string) => {
  if (/RETURNING id/.test(sql)) return { rows: [{ id: `msg-${++n}` }] };
  return { rows: [] };
};

// Model whose invoke() returns the next scripted content each call (last repeats).
function scriptedModel(seq: string[]): NonNullable<ComposerTestHooks['model']> {
  let i = 0;
  return { invoke: async () => ({ content: seq[Math.min(i++, seq.length - 1)] }) };
}

const PRE = { ragWisdom: '', legacyQuestions: [], convState: null, questionsWereRetrieved: false, knowledgePlanUsed: null };
const POLICY = { moveDecision: null, knowledgePlan: null, enforceMovePolicy: false };

async function run(utterance: string, seq: string[]) {
  const env = createStateEnvelope({
    userId: 'user-1', conversationId: 'conv-1', utterance,
    conversationHistory: [], userName: 'Tester', // empty history => trajectory gate is inert
  });
  const result = await runComposerPipeline(env, '', PRE, POLICY, { model: scriptedModel(seq), queryFn });
  await new Promise((r) => setTimeout(r, 40)); // let fire-and-forget persist settle
  return { env, result };
}

(async () => {
  // Draft 1: clean at the boundary, but substitutes the user's words
  //   ("cheated"→"betrayal", "throw up"→"heavy feeling") → trips vocab fidelity.
  const CLEAN_BUT_VOCAB = 'That betrayal must weigh on you — a heavy feeling that sits in the chest.';
  // The vocab REWRITE the stub returns: contains legal advice, and echoes a user
  //   word ("cheated") so it PASSES the vocab re-verify (isolating the boundary
  //   re-entry as the thing that must catch it).
  const LEGAL_REWRITE = "Honestly, you should file for divorce first and you'll get full custody since she cheated.";

  console.log('\n── Preconditions: the stub drafts trip exactly the intended gates ──');
  assert('draft 1 is clean at the boundary', checkBoundary(CLEAN_BUT_VOCAB).passed === true,
    JSON.stringify(checkBoundary(CLEAN_BUT_VOCAB).violations));
  assert('the vocab rewrite really is legal advice', checkBoundary(LEGAL_REWRITE).legal_advice === true);
  assert('the fallback clears the boundary gate', checkBoundary(buildLegalAdviceFallback()).legal_advice === false
    && checkBoundary(buildLegalAdviceFallback()).passed === true);

  console.log('\n── 1. Legal advice introduced by a craft (vocab) rewrite → fail closed ──');
  {
    const { env, result } = await run('my wife cheated and i want to throw up over all of it',
      [CLEAN_BUT_VOCAB, LEGAL_REWRITE]);
    assert('the vocab gate fired (it introduced the advice)', env.regen_triggers.includes('vocab_fidelity'));
    assert('the craft rewrite RE-ENTERED the boundary loop', env.regen_triggers.includes('boundary'));
    assert('shipped response is the safe legal-advice fallback, NOT the advice',
      result.response === buildLegalAdviceFallback(), result.response);
    assert("regen_triggers records legal_advice_fallback", env.regen_triggers.includes('legal_advice_fallback'));
    assert('no legal advice reaches the man (final content clears the gate)',
      checkBoundary(result.response).legal_advice === false && checkBoundary(result.response).passed === true);
    assert('the advice draft never ships', !/file for divorce|full custody/i.test(result.response));
  }

  console.log('\n── 2. Craft gate still trips after its rewrite → best draft kept, recorded ──');
  {
    // Every draft the stub returns contains a forbidden phrase ("take a deep breath").
    const FORBIDDEN = 'Take a deep breath and let the day settle a little.';
    const { env, result } = await run('work has been busy lately, nothing major', [FORBIDDEN]);
    assert('the forbidden gate looped to the budget, re-verifying each draft',
      env.regen_triggers.filter(t => t === 'forbidden_phrase').length === MAX_REGENS,
      `forbidden regens=${env.regen_triggers.filter(t => t === 'forbidden_phrase').length}`);
    assert('the still-tripping best draft is KEPT (not blanked, not replaced)',
      result.response === FORBIDDEN, result.response);
    assert('the shipped reply still trips the detector (proof it was kept, i.e. skippedGates)',
      detectForbiddenPhrases(result.response).length > 0);
    assert('a craft-only failure never triggers the legal fallback',
      !env.regen_triggers.includes('legal_advice_fallback'));
    assert('total regens never exceed the shared budget',
      env.regen_triggers.filter(t => t.endsWith('_fidelity') || t === 'boundary' || t === 'forbidden_phrase' || t === 'fantasy_identity' || t === 'trajectory_dedup').length <= MAX_REGENS);
  }

  console.log('\n── SUMMARY ──');
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); }
  console.log('  ✅ SUITE PASSED');
  process.exit(0);
})();
