/**
 * Deterministic regression for turn_logs INSERT assembly.
 * Usage: npx tsx scripts/test-turn-logger-insert.ts
 */

import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import { buildTurnLogInsertValues, getTurnLogColumns } from '../src/lib/observability/turn-logger';

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
  const matches = [...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
  return matches;
}

const envelope = createStateEnvelope({
  userId: 'test-user',
  conversationId: 'test-conversation',
  utterance: 'this is a regression fixture',
  conversationHistory: [],
});
envelope.final_response = 'final response';
envelope.total_ms = 123;
envelope.policy_diagnostics.no_question_override_active = true;
envelope.policy_diagnostics.enforced = false;
envelope.policy_diagnostics.final_question_count = 1;
envelope.policy_diagnostics.questions_were_retrieved = false;
envelope.policy_diagnostics.question_candidates_passed = false;

const plan = buildTurnLogInsertValues(envelope);
const columns = getTurnLogColumns();
const sqlPlaceholders = placeholders(plan.sql);
const expectedCount = columns.length;

assert('number of columns is 47', columns.length === 47, `columns=${columns.length}`);
assert('number of values is 47', plan.values.length === 47, `values=${plan.values.length}`);
assert('number of placeholders is 47', sqlPlaceholders.length === 47, `placeholders=${sqlPlaceholders.length}`);
assert('placeholders are sequential from $1..$47', sqlPlaceholders.every((n, i) => n === i + 1));

const highestPlaceholder = Math.max(...sqlPlaceholders);
assert('highest placeholder equals parameter count', highestPlaceholder === expectedCount);
assert('policy_no_question_override_active is final column', columns[columns.length - 1] === 'policy_no_question_override_active');
assert('policy_no_question_override_active uses final placeholder', plan.sql.includes(`$${expectedCount}`));
const mappedPolicyValue = plan.values[plan.values.length - 1];
assert(
  'policy_no_question_override_active maps to final value',
  mappedPolicyValue === envelope.policy_diagnostics.no_question_override_active,
  `mapped=${String(mappedPolicyValue)} expected=${String(envelope.policy_diagnostics.no_question_override_active)}`
);

console.log('\n' + '─'.repeat(60));
console.log(`turn-logger INSERT regression: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('❌ TURN-LOGGER INSERT REGRESSION FAILED');
  process.exit(1);
}
console.log('✅ TURN-LOGGER INSERT REGRESSION PASSED');
