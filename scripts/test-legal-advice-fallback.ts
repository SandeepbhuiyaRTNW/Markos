/**
 * Legal-advice FAIL-CLOSED — deterministic tests (no OpenAI, no DB).
 * Run: npx tsx scripts/test-legal-advice-fallback.ts
 *
 * WHAT THESE TESTS PROVE (and what they DON'T):
 *
 *   They prove the COMPOSER's control flow around the boundary gate:
 *     - the boundary check RE-VERIFIES each regenerated draft (a real loop, not
 *       one unverified retry);
 *     - a draft that keeps tripping LEGAL_ADVICE_PATTERNS through the whole regen
 *       budget is REPLACED with the safe fallback and does NOT ship;
 *     - a draft that recovers within budget ships the recovered draft (no fallback);
 *     - the fallback itself clears checkBoundary();
 *     - the distinct 'legal_advice_fallback' signal is recorded.
 *
 *   They do NOT — and CANNOT here — prove the model obeys the orient-not-advise
 *   instruction, nor that the regex catches every legal-advice phrasing. The
 *   guard is pattern-matching: a slip worded outside LEGAL_ADVICE_PATTERNS passes
 *   the gate untouched (asserted below as an explicit, honest limit). With no
 *   OPENAI_API_KEY the model is a stub returning fixed strings; a real model's
 *   compliance is exactly what this environment cannot exercise.
 */
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import {
  runComposerPipeline,
  buildLegalAdviceFallback,
  type ComposerTestHooks,
} from '../src/lib/agents/orchestrator-v2-composer';
import { checkBoundary } from '../src/lib/sentinels/boundary';

const MAX_REGENS = 2; // mirrors the constant inside runComposerPipeline

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

// A draft that crosses hard into legal advice on multiple axes (directive + outcome).
const PERSISTENT_ADVICE = "You should file first, and you'll get full custody of the kids.";
// A clean, in-voice draft that clears every boundary pattern.
const CLEAN_REPLY = "That fear of losing them — say more about what today actually looked like.";

// Fake query: returns an id for RETURNING inserts, empty otherwise. Never hits a DB.
let n = 0;
const queryFn: NonNullable<ComposerTestHooks['queryFn']> = async (sql: string) => {
  if (/RETURNING id/.test(sql)) return { rows: [{ id: `msg-${++n}` }] };
  return { rows: [] };
};

// Build a mock model whose invoke() returns the next scripted content each call.
function scriptedModel(sequence: string[]): NonNullable<ComposerTestHooks['model']> {
  let i = 0;
  return { invoke: async () => ({ content: sequence[Math.min(i++, sequence.length - 1)] }) };
}

function freshEnv() {
  return createStateEnvelope({
    userId: 'user-1', conversationId: 'conv-1',
    utterance: 'my wife filed and I might lose the kids',
    conversationHistory: [], userName: 'Tester',
  });
}
const PRE = { ragWisdom: '', legacyQuestions: [], convState: null, questionsWereRetrieved: false, knowledgePlanUsed: null };
const POLICY = { moveDecision: null, knowledgePlan: null, enforceMovePolicy: false };

async function run(sequence: string[]) {
  const env = freshEnv();
  const result = await runComposerPipeline(env, '', PRE, POLICY, { model: scriptedModel(sequence), queryFn });
  await new Promise((r) => setTimeout(r, 40)); // let fire-and-forget persist settle
  return { env, result };
}

(async () => {
  console.log('\n── The detector is not vacuous: the advice draft really trips legal_advice ──');
  {
    const r = checkBoundary(PERSISTENT_ADVICE);
    assert('PERSISTENT_ADVICE trips LEGAL_ADVICE_PATTERNS', r.legal_advice === true && r.passed === false,
      JSON.stringify(r.violations));
    assert('CLEAN_REPLY clears the boundary gate', checkBoundary(CLEAN_REPLY).passed === true);
    assert('the fallback itself clears the boundary gate', checkBoundary(buildLegalAdviceFallback()).passed === true
      && checkBoundary(buildLegalAdviceFallback()).legal_advice === false);
  }

  console.log('\n── FAIL CLOSED: a persistent legal-advice draft ends in the fallback, NOT the advice ──');
  {
    // Model refuses to comply on every call (initial + both regens).
    const { env, result } = await run([PERSISTENT_ADVICE, PERSISTENT_ADVICE, PERSISTENT_ADVICE]);
    assert('shipped response is NOT the advice draft', result.response !== PERSISTENT_ADVICE, result.response);
    assert('shipped response IS the safe fallback', result.response === buildLegalAdviceFallback());
    assert('shipped response clears the boundary gate (no legal advice reaches the man)',
      checkBoundary(result.response).legal_advice === false && checkBoundary(result.response).passed === true);
    assert('fallback declines the legal question (hands it to an attorney)',
      /family-law attorney in your state/.test(result.response));
    assert('fallback stays present, does not abandon him',
      /I'm not going anywhere/.test(result.response) && /Tell me where you're at/.test(result.response));
    assert('fallback does not read as a system error',
      !/error|override|system|unable|cannot process|try again/i.test(result.response));
    assert('it LOOPED to the budget, not one unverified retry',
      env.regen_triggers.filter(t => t === 'boundary').length === MAX_REGENS,
      `boundary regens=${env.regen_triggers.filter(t => t === 'boundary').length}`);
    assert("distinct 'legal_advice_fallback' signal recorded for observability",
      env.regen_triggers.includes('legal_advice_fallback'));
    assert('env.final_response is the fallback (what persists == what ships)',
      env.final_response === buildLegalAdviceFallback());
  }

  console.log('\n── RECOVER within budget: a draft that stops crossing ships the recovered draft ──');
  {
    // First draft trips legal advice; the very next regen is clean.
    const { env, result } = await run([PERSISTENT_ADVICE, CLEAN_REPLY, CLEAN_REPLY]);
    assert('shipped response is the recovered clean draft', result.response === CLEAN_REPLY, result.response);
    assert('fallback did NOT fire (recovered before budget spent)',
      !env.regen_triggers.includes('legal_advice_fallback'));
    assert('exactly one boundary regen was needed',
      env.regen_triggers.filter(t => t === 'boundary').length === 1,
      `boundary regens=${env.regen_triggers.filter(t => t === 'boundary').length}`);
    assert('recovered draft clears the boundary gate', checkBoundary(result.response).passed === true);
  }

  console.log('\n── CLEAN first draft: no regen, no fallback ──');
  {
    const { env, result } = await run([CLEAN_REPLY]);
    assert('clean draft ships unchanged', result.response === CLEAN_REPLY, result.response);
    assert('no boundary regen fired', !env.regen_triggers.includes('boundary'));
    assert('no fallback fired', !env.regen_triggers.includes('legal_advice_fallback'));
  }

  console.log('\n── HONEST LIMIT: a legal-advice slip worded OUTSIDE the patterns is NOT caught ──');
  {
    // Advice in substance ("just end it, that's the move") but not in any enumerated
    // LEGAL_ADVICE_PATTERN. The gate does not fire — documenting exactly what this
    // guard cannot do. A model that phrases advice this way would ship it.
    const uncaught = "Honestly, just end it — that's the move, and don't look back.";
    const r = checkBoundary(uncaught);
    assert('regex does NOT catch this un-patterned advice (limit is explicit)', r.legal_advice === false,
      JSON.stringify(r.violations));
  }

  console.log('\n── SUMMARY ──');
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); }
  console.log('  ✅ SUITE PASSED');
  process.exit(0);
})();
