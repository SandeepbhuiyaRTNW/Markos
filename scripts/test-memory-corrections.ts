/**
 * Memory Corrections — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-memory-corrections.ts
 *
 * WHAT THESE TESTS PROVE: the lexical gate, the response parser, and the
 * target-resolution logic (which existing memory row a correction overwrites)
 * behave correctly. They do NOT prove the gpt-4o-mini correction pass
 * classifies real messages correctly — that needs an API key and lives in
 * manual QA, same as every other LLM-dependent path in this repo.
 */

import {
  detectCorrectionSignal,
  parseCorrectionResponse,
  resolveCorrectionTargets,
  buildCorrectionPrompt,
  type MemoryRow,
  type ParsedCorrection,
} from '../src/lib/memory/corrections';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const EXISTING: MemoryRow[] = [
  { id: 'id-1', layer_number: 2, key: 'brother_name', value: 'David', confidence: 0.9 },
  { id: 'id-2', layer_number: 1, key: 'job', value: 'accountant', confidence: 0.7 },
  { id: 'id-3', layer_number: 3, key: 'dream', value: 'wants to become a chef', confidence: 1.0 },
];

function corr(c: Partial<ParsedCorrection>): ParsedCorrection {
  return { match_key: null, layer_number: NaN, key: '', corrected_value: '', ...c };
}

async function main() {
  console.log('\n── A. Correction signal gate ──');
  const POSITIVE = [
    'No, his name is Daniel, not David.',
    "that's not right, my brother is Daniel",
    'I told you his name was Daniel.',
    'I said she left in March, not May.',
    "you're wrong about that",
    'You got that wrong, it was Tuesday.',
    "no, it's actually my uncle",
    'His name is Daniel. (after Marcus said David)',
    'I meant the Minneapolis office.',
    'Actually, her name is Priya.',
    'Correction: the meeting is Thursday.',
  ];
  const NEGATIVE = [
    'work was really hard today',
    'my brother David is visiting next week',
    'I want to talk about my divorce',
    'thank you, that helps',
    'what do you think I should do?',
  ];
  for (const m of POSITIVE) assert(`signal fires: "${m.slice(0, 48)}"`, detectCorrectionSignal(m));
  for (const m of NEGATIVE) assert(`signal silent: "${m.slice(0, 48)}"`, !detectCorrectionSignal(m));

  console.log('\n── B. Response parsing (robust key-finding, mirrors extractMemories) ──');
  const good = JSON.stringify({ corrections: [{ match_key: 'brother_name', layer_number: 2, key: 'brother_name', corrected_value: 'his brother is named Daniel' }] });
  assert('parses canonical shape', parseCorrectionResponse(good).length === 1);
  assert('parses array under a different key', parseCorrectionResponse(JSON.stringify({ fixes: [{ match_key: null, layer_number: 2, key: 'brother_name', corrected_value: 'Daniel' }] })).length === 1);
  assert('parses bare array', parseCorrectionResponse(JSON.stringify([{ match_key: null, layer_number: 1, key: 'job', corrected_value: 'teacher' }])).length === 1);
  assert('malformed JSON → empty, never throws', parseCorrectionResponse('{not json').length === 0);
  assert('empty object → empty', parseCorrectionResponse('{}').length === 0);
  assert('entries without corrected_value are dropped', parseCorrectionResponse(JSON.stringify({ corrections: [{ match_key: null, layer_number: 2, key: 'x' }] })).length === 0);
  const parsed = parseCorrectionResponse(good)[0];
  assert('match_key preserved', parsed.match_key === 'brother_name');
  assert('non-string match_key → null', parseCorrectionResponse(JSON.stringify({ corrections: [{ match_key: 4, layer_number: 2, key: 'k', corrected_value: 'v' }] }))[0].match_key === null);

  console.log('\n── C. Target resolution — the wrong row dies, the right row wins ──');
  const t1 = resolveCorrectionTargets(EXISTING, [corr({ match_key: 'brother_name', layer_number: 2, key: 'brother_name', corrected_value: 'his brother is named Daniel' })]);
  assert('exact match_key → update, not insert', t1.length === 1 && t1[0].action === 'update' && t1[0].id === 'id-1');
  assert('update carries previous_value', t1[0].previous_value === 'David');
  assert('update keeps the existing row key', t1[0].key === 'brother_name');
  const t2 = resolveCorrectionTargets(EXISTING, [corr({ match_key: 'BROTHER_NAME', layer_number: 2, key: 'brother_name', corrected_value: 'Daniel' })]);
  assert('key match is case-insensitive', t2.length === 1 && t2[0].action === 'update');
  const t3 = resolveCorrectionTargets(EXISTING, [corr({ match_key: null, layer_number: 2, key: 'sister_name', corrected_value: 'his sister is named Amy' })]);
  assert('no match → insert new row', t3.length === 1 && t3[0].action === 'insert' && t3[0].key === 'sister_name');
  const t4 = resolveCorrectionTargets(EXISTING, [corr({ match_key: null, layer_number: 9, key: 'sister_name', corrected_value: 'Amy' })]);
  assert('insert with invalid layer → skipped (no guess-key duplicates)', t4.length === 0);
  const t5 = resolveCorrectionTargets(EXISTING, [corr({ match_key: 'brother', layer_number: 2, key: 'brother', corrected_value: 'Daniel' })]);
  assert('fuzzy key does NOT merge (brother ≠ brother_name), inserts only if layer valid', t5.length === 1 && t5[0].action === 'insert');
  const t6 = resolveCorrectionTargets(EXISTING, []);
  assert('no corrections → no targets', t6.length === 0);
  const t7 = resolveCorrectionTargets(EXISTING, [
    corr({ match_key: 'brother_name', layer_number: 2, key: 'brother_name', corrected_value: 'Daniel' }),
    corr({ match_key: 'job', layer_number: 1, key: 'job', corrected_value: 'software engineer' }),
  ]);
  assert('multiple corrections in one message all resolve', t7.length === 2 && t7.every(t => t.action === 'update'));

  console.log('\n── D. Correction prompt carries existing memory state ──');
  const { system, user } = buildCorrectionPrompt(EXISTING, 'No, his name is Daniel, not David.');
  assert('prompt lists existing keys', user.includes('brother_name') && user.includes('job'));
  assert('prompt lists existing values', user.includes('David'));
  assert('prompt carries his message', user.includes('Daniel'));
  assert('system demands corrected value is the NEW truth', system.includes('NEW truth'));
  assert('system demands match_key reuse over new keys', system.includes('match_key'));
  assert('system allows empty result', system.includes('{"corrections": []}'));

  console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main();
