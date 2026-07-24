/**
 * Tests for CI context read-side wiring (feature/ci-context-readside).
 * Run: npx tsx scripts/test-ci-context.ts
 *
 * Deterministic — no DB, no LLM. Covers the flag, the byte-identical merge when
 * off, the prompt-craft render, and the natural-recall / banned-phrase framing.
 */

import { ciContextEnabled, renderCICallback, mergeMemoryContext } from '../src/lib/intelligence/ci-context';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n── A. flag (default OFF) ──');
delete process.env.CI_CONTEXT_ENABLED;
assert('unset -> false', ciContextEnabled() === false);
process.env.CI_CONTEXT_ENABLED = 'false';
assert('"false" -> false', ciContextEnabled() === false);
process.env.CI_CONTEXT_ENABLED = '1';
assert('"1" -> true', ciContextEnabled() === true);
process.env.CI_CONTEXT_ENABLED = 'true';
assert('"true" -> true', ciContextEnabled() === true);
delete process.env.CI_CONTEXT_ENABLED;

console.log('\n── B. mergeMemoryContext — byte-identical when no CI ──');
assert('base + null CI -> base unchanged (flag off path)', mergeMemoryContext('FACTS about him', null) === 'FACTS about him');
assert('base + empty CI -> base', mergeMemoryContext('FACTS', '') === 'FACTS');
assert('base + whitespace CI -> base', mergeMemoryContext('FACTS', '   \n ') === 'FACTS');
assert('null base + null CI -> undefined (== old `x || undefined`)', mergeMemoryContext(null, null) === undefined);
assert('empty base + null CI -> undefined', mergeMemoryContext('', null) === undefined);
assert('base + CI -> appended as distinct block (both coexist)',
  mergeMemoryContext('FACTS', 'CI BLOCK') === 'FACTS\n\nCI BLOCK');
assert('null base + CI -> just CI', mergeMemoryContext(null, 'CI BLOCK') === 'CI BLOCK');

console.log('\n── C. renderCICallback — prompt-craft frame ──');
assert('empty raw -> empty (no header)', renderCICallback('') === '');
assert('whitespace raw -> empty', renderCICallback('   ') === '');
const raw = `OPEN LOOP (unresolved — reference naturally if it fits, do not interrogate):\n- he was dreading telling his kids about the move`;
const block = renderCICallback(raw);
assert('non-empty raw -> wrapped block', block.length > raw.length);
assert('includes the friend-who-remembers header', block.includes('SOMETHING YOU REMEMBER ABOUT HIM'));
assert('carries the raw surfacing content', block.includes('he was dreading telling his kids'));
assert('includes the GOOD natural-recall example', block.includes("Last time you were dreading telling your kids"));
assert('bans mechanical recall ("According to my records")', block.includes('According to my records'));
assert('bans "open loop" record-speak', block.includes('you have 1 open loop'));
assert('instructs: do not force on unrelated topics', block.toLowerCase().includes('do not force it'));
assert('instructs: at most one, woven in', block.includes('AT MOST ONE'));
assert('instructs: thread not facts (dedup)', block.toLowerCase().includes('not repeating facts'));
assert('instructs: bias toward NOT surfacing when unsure (leave it out)', block.toLowerCase().includes('leave it out'));
assert('instructs: under-surfacing is the safe failure', block.toLowerCase().includes('under-surfacing is the safe failure'));

console.log('\n── SUMMARY ──');
console.log(`  passed: ${passed}   failed: ${failed}`);
if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); }
else console.log('  ✅ SUITE PASSED');
