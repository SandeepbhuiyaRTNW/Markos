import assert from 'node:assert/strict';
import { readContextOr } from '../src/lib/agents/context-read';
import { MARCUS_SYSTEM_PROMPT } from '../src/lib/agent/system-prompt';
async function main() {
  const errors: unknown[] = [];
  const reads = await Promise.all([
    readContextOr(Promise.resolve('personal memory'), '', e => errors.push(e)),
    readContextOr(Promise.reject(new Error('style unavailable')), '', e => errors.push(e)),
    readContextOr(Promise.resolve('recent continuity'), '', e => errors.push(e)),
  ]);
  assert.deepEqual(reads, ['personal memory', '', 'recent continuity']);
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as Error).message, 'style unavailable');
  assert.deepEqual(await readContextOr(Promise.reject(new Error('DB')), { rows: [] }, () => {}), { rows: [] });
  assert.equal(await readContextOr(Promise.resolve(null), 'fallback' as string | null, () => {}), null);
  assert.ok(!MARCUS_SYSTEM_PROMPT.includes('and NOT a friend'));
  assert.ok(!MARCUS_SYSTEM_PROMPT.includes('Never accept a relational role'));
  assert.ok(!MARCUS_SYSTEM_PROMPT.includes('Your job is to PROBE'));
  assert.ok(!MARCUS_SYSTEM_PROMPT.includes('FRAME REFUSAL (ROLE BOUNDARIES)'));
  assert.ok(MARCUS_SYSTEM_PROMPT.includes('You are Marcus Aurelius'));
  assert.ok(MARCUS_SYSTEM_PROMPT.includes('Do not replace the request with a question about his feelings'));
  assert.ok(MARCUS_SYSTEM_PROMPT.includes('not professional advice'));
  console.log('Context isolation + conversational prompt: 12 assertions passed (no DB/LLM).');
}
void main();
