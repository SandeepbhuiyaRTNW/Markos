/**
 * Deterministic SQL regression for retrieveWisdom query construction.
 * Usage: npx tsx scripts/test-retriever-sql.ts
 */

import { buildWisdomRetrievalQuery } from '../src/lib/rag/retriever';

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail: string = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function placeholders(sql: string): number[] {
  const matches = [...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
  return matches;
}

function noAndAfterOrderBy(sql: string): boolean {
  const orderIdx = sql.indexOf('ORDER BY');
  if (orderIdx === -1) return false;
  const afterOrder = sql.slice(orderIdx);
  return !/\bAND\b/.test(afterOrder);
}

function maxPlaceholder(sql: string): number {
  const values = placeholders(sql);
  if (values.length === 0) return 0;
  return Math.max(...values);
}

function expectsSequentialPlaceholders(sql: string): boolean {
  const values = Array.from(new Set(placeholders(sql))).sort((a, b) => a - b);
  if (values.length === 0) return false;
  const last = values[values.length - 1];
  return values[0] === 1 && values.every((v, i) => v === i + 1) && values.length === last;
}

const limit = 5;

const noExclusions = buildWisdomRetrievalQuery('[vec]', limit * 2, []);
assert('no exclusions -> no AND after ORDER BY', noAndAfterOrderBy(noExclusions.sql));
assert('no exclusions -> params length is 2', noExclusions.params.length === 2, `got=${noExclusions.params.length}`);
assert('no exclusions -> param 1 is vector payload', noExclusions.params[0] === '[vec]');
assert('no exclusions -> LIMIT uses $2', noExclusions.sql.includes('LIMIT $2'));
assert('no exclusions -> placeholders are 1..2', expectsSequentialPlaceholders(noExclusions.sql) && maxPlaceholder(noExclusions.sql) === 2);

const exclusionsOnly = buildWisdomRetrievalQuery('[vec]', limit * 2, ['Stoic', 'KWML']);
assert('exclusions only -> no AND after ORDER BY', noAndAfterOrderBy(exclusionsOnly.sql));
assert('exclusions only -> excludes use $3 and remain parameterized', exclusionsOnly.sql.includes('lower(metadata->>\'domain\') <> ALL($3::text[])'));
assert('exclusions only -> params length is 3', exclusionsOnly.params.length === 3);
assert('exclusions only -> LIMIT still uses $2', exclusionsOnly.sql.includes('LIMIT $2'));
assert('exclusions only -> placeholders are 1..3', expectsSequentialPlaceholders(exclusionsOnly.sql) && maxPlaceholder(exclusionsOnly.sql) === 3);
assert('exclusions only -> preserve untagged rows', exclusionsOnly.sql.includes("metadata->>'domain' IS NULL"));

const towardOnly = buildWisdomRetrievalQuery('[vec]', limit * 2, [], ['grief', 'divorce']);
assert('toward only -> no AND after ORDER BY', noAndAfterOrderBy(towardOnly.sql));
assert('toward only -> params length is 2', towardOnly.params.length === 2);
assert('toward only -> LIMIT uses $2', towardOnly.sql.includes('LIMIT $2'));
assert('toward only -> placeholders are 1..2', expectsSequentialPlaceholders(towardOnly.sql) && maxPlaceholder(towardOnly.sql) === 2);
assert('toward only -> no exclusion predicate', !towardOnly.sql.includes('<> ALL($3::text[])'));

const exclusionsAndToward = buildWisdomRetrievalQuery('[vec]', limit * 2, ['shadow'], ['grief']);
assert('exclusions + toward -> no AND after ORDER BY', noAndAfterOrderBy(exclusionsAndToward.sql));
assert('exclusions + toward -> params length is 3', exclusionsAndToward.params.length === 3);
assert('exclusions + toward -> placeholders are 1..3', expectsSequentialPlaceholders(exclusionsAndToward.sql) && maxPlaceholder(exclusionsAndToward.sql) === 3);
assert('exclusions + toward -> LIMIT still uses $2', exclusionsAndToward.sql.includes('LIMIT $2'));
assert('exclusions + toward -> exclusion predicate still applied', exclusionsAndToward.sql.includes("lower(metadata->>'domain') <> ALL($3::text[])"));

console.log('\n' + '─'.repeat(50));
console.log(`retrieveWisdom SQL regression: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ RETRIEVER SQL REGRESSION FAILED');
  process.exit(1);
}
console.log('✅ RETRIEVER SQL REGRESSION PASSED');
