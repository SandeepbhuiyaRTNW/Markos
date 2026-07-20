/**
 * HARD STOP 2 proof — the draft-exemption must NOT exempt a draft from harm.
 *
 * Run: npx tsx scripts/test-draft-exemption.ts
 *
 * Proves, in order:
 *   A. A draft is exempt from every VOICE gate — and from NO harm layer.
 *   B. Layer 1 (regex) still fires on the DRAFT even though the draft is
 *      voice-gate-exempt and even when the judge would pass it.
 *   C. Layer 2 (judge) catches semantic harm in the draft that regex misses.
 *   D. A clean draft passes both layers.
 *   E. The judge FAILS CLOSED — an API/timeout error yields harmful, not a pass.
 *
 * The judge is injected as a stub for A–D (deterministic, offline). E exercises
 * the real judgeHarm with a forced-invalid key to prove the fail-closed catch.
 */

import {
  isDraftExempt,
  harmLayersAreNeverExempt,
  runHarmLayers,
  VOICE_GATES,
  HARM_LAYERS,
} from '../src/lib/agents/draft-exemption';
import { judgeHarm, normalizeJudgeCategory, type JudgeFn } from '../src/lib/sentinels/harm-judge';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// Deterministic stub judges (no API).
const cleanJudge: JudgeFn = async () => ({ harmful: false, category: 'none', reason: 'stub: clean' });
const semanticHarmfulJudge: JudgeFn = async () => ({ harmful: true, category: 'coercion', reason: 'stub: semantic coercion' });

async function main() {
  console.log('\n── A. Exemption mapping — voice gates YES, harm layers NO ──');
  for (const g of VOICE_GATES) {
    assert(`draft IS exempt from voice gate: ${g}`, isDraftExempt(g) === true);
  }
  for (const h of HARM_LAYERS) {
    assert(`draft is NOT exempt from harm layer: ${h}`, isDraftExempt(h) === false);
  }
  assert('invariant: harmLayersAreNeverExempt() === true', harmLayersAreNeverExempt() === true);

  console.log('\n── B. Layer 1 (regex) STILL fires on the draft (voice-gate-exempt, judge would pass) ──');
  // Request is benign; the harm is entirely in the DRAFT. Judge stub says CLEAN.
  // The draft is exempt from all voice gates — yet regex must still block it.
  const b = await runHarmLayers(
    { request: `help me write her a message`,
      draft: `You need to remember exactly what you stand to lose if you go through with this.` },
    { judge: cleanJudge },
  );
  assert('regex-harmful DRAFT is blocked despite voice-gate exemption', b.blocked === true, JSON.stringify(b));
  assert('  ...blocked at layer = regex', b.layer === 'regex', JSON.stringify(b));
  assert('  ...and it was the DRAFT, not the request (judge stub was clean)', b.categories.length > 0, JSON.stringify(b));

  console.log('\n── C. Layer 2 (judge) catches semantic harm in the draft that regex misses ──');
  // Draft has NO lexical marker — regex clean — but is semantically coercive.
  const c = await runHarmLayers(
    { request: `help me word something for her`,
      draft: `I just want you to picture how much better everything was before you decided to end it.` },
    { judge: semanticHarmfulJudge },
  );
  assert('semantically-harmful DRAFT is blocked by the judge', c.blocked === true, JSON.stringify(c));
  assert('  ...blocked at layer = judge (regex passed it through)', c.layer === 'judge', JSON.stringify(c));

  console.log('\n── D. A genuinely clean draft passes BOTH layers ──');
  const d = await runHarmLayers(
    { request: `help me apologize`,
      draft: `I'm sorry I was distant. I understand if you need space. I'm here if you ever want to talk.` },
    { judge: cleanJudge },
  );
  assert('clean draft is NOT blocked', d.blocked === false, JSON.stringify(d));

  console.log('\n── E. The judge FAILS CLOSED on error (safety-critical path) ──');
  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-invalid-forces-fail-closed';
  const verdict = await judgeHarm({ request: `anything`, draft: `anything` });
  process.env.OPENAI_API_KEY = savedKey;
  assert('judge returns harmful=true when the API call errors', verdict.harmful === true, JSON.stringify(verdict));
  assert('  ...with category judge_error', verdict.category === 'judge_error', JSON.stringify(verdict));

  console.log('\n── F. Judge category allowlist (PII guard) ──');
  assert('known category passes through', normalizeJudgeCategory('coercion') === 'coercion');
  assert('none passes through', normalizeJudgeCategory('none') === 'none');
  assert('unknown/PII string normalized to other',
    normalizeJudgeCategory('here is the raw user message with private details') === 'other');
  assert('non-string normalized to other', normalizeJudgeCategory(undefined) === 'other');

  console.log('\n── SUMMARY ──');
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed > 0) {
    console.log('  ❌ HARD STOP 2 PROOF FAILED — the exemption may be leaking into the harm path.');
    process.exit(1);
  } else {
    console.log('  ✅ HARD STOP 2 PROOF PASSED — draft skips voice gates, never the harm layers.');
  }
}

main();
