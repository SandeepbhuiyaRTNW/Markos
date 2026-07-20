/**
 * Instrumentation tests — the comm-assist metrics must be PII-free.
 * Run: npx tsx scripts/test-comm-assist-metrics.ts
 */

import { buildCommAssistMetrics, commAssistMetricsLogLine } from '../src/lib/observability/comm-assist-metrics';
import type { CommAssistResult } from '../src/lib/agents/comm-assist-path';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

const ALLOWED_KEYS = ['move', 'path', 'harm_regex_blocked', 'harm_judge_blocked', 'blocked_stage', 'refusal_category', 'ki_rule', 'latency_ms'].sort();

console.log('\n── comm-assist metrics: shape + PII-free ──');

// A refusal that carried sensitive text in the ORIGINAL result.
const SECRET_REFUSAL_TEXT = `I will not help write something designed to make her afraid of what she would lose.`;
const refusal: CommAssistResult = {
  kind: 'refusal',
  refusal: SECRET_REFUSAL_TEXT,
  blockedLayer: 'regex',
  categories: ['coercion_leverage'],
  stage: 'request',
};
const m1 = buildCommAssistMetrics(refusal, { latencyMs: 42, kiRule: 'help_communicate' });

assert('1  only the allowed structural keys are present',
  JSON.stringify(Object.keys(m1).sort()) === JSON.stringify(ALLOWED_KEYS), JSON.stringify(Object.keys(m1)));
assert('2  path === refused', m1.path === 'refused');
assert('3  harm_regex_blocked === true', m1.harm_regex_blocked === true);
assert('4  blocked_stage === request', m1.blocked_stage === 'request');
assert('5  refusal_category is the KEY, not the text', m1.refusal_category === 'coercion_leverage');
assert('6  serialized metrics do NOT contain the refusal text (no PII)',
  !commAssistMetricsLogLine(m1).includes(SECRET_REFUSAL_TEXT) && !JSON.stringify(m1).includes('afraid'));

// A drafted (clean) turn.
const drafted: CommAssistResult = {
  kind: 'draft',
  intro: 'Here is an honest version.',
  draft: `I'm sorry I was distant.`,
  follow_up: 'What matters most to say?',
};
const m2 = buildCommAssistMetrics(drafted, { latencyMs: 900, kiRule: 'help_communicate' });
assert('7  drafted turn: path === drafted', m2.path === 'drafted');
assert('8  drafted turn: no harm layer blocked, no refusal category',
  m2.harm_regex_blocked === false && m2.harm_judge_blocked === false && m2.refusal_category === null);
assert('9  drafted metrics do NOT contain the draft text (no PII)',
  !JSON.stringify(m2).includes('sorry') && !JSON.stringify(m2).includes('distant'));

console.log('\n── SUMMARY ──');
console.log(`  passed: ${passed}   failed: ${failed}`);
if (failed > 0) { console.log('  ❌ SUITE FAILED'); process.exit(1); }
else console.log('  ✅ SUITE PASSED');
