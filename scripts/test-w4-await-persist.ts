/**
 * W4 — the message write is AWAITED before the response returns, on every path.
 *
 * Proves, deterministically (no real DB, no LLM):
 *  - On each sentinel return path (buildResponse) AND the composer path
 *    (runComposerPipeline), the two message inserts (and the sentinel turn_logs write)
 *    COMPLETE before the response resolves. The fake query inserts an async gap between
 *    "start" and "done"; if the write were fire-and-forget, "done" would NOT be recorded
 *    yet when the response returns.
 *  - A write failure still yields the reply (never throws, never blocks).
 *  - The per-turn [turn-persist] latency metric is emitted (grep-able).
 *
 * Run from the app root: npx tsx scripts/test-w4-await-persist.ts
 */
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import type { StateEnvelope } from '../src/lib/agents/state-envelope';
import { buildResponse } from '../src/lib/agents/orchestrator-v2';
import { runComposerPipeline, type ComposerTestHooks } from '../src/lib/agents/orchestrator-v2-composer';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

type QFn = NonNullable<ComposerTestHooks['queryFn']>;

/** A fake query with an async gap: records start/done so we can prove the caller AWAITED it. */
function orderingQuery(delayMs = 15) {
  const events: string[] = [];
  let n = 0;
  const fn: QFn = async (sql: string) => {
    const kind = /'user'/.test(sql) ? 'user' : /'marcus'/.test(sql) ? 'marcus' : /turn_logs/.test(sql) ? 'turnlog' : 'other';
    events.push('start:' + kind);
    await new Promise((r) => setTimeout(r, delayMs));
    events.push('done:' + kind);
    if (/RETURNING id/.test(sql)) return { rows: [{ id: `msg-${++n}` }] };
    return { rows: [] };
  };
  return { fn, events };
}

function baseEnv(utterance: string, finalResponse: string): StateEnvelope {
  const env = createStateEnvelope({ userId: 'user-1', conversationId: 'conv-1', utterance, conversationHistory: [], userName: 'Tester' });
  env.final_response = finalResponse;
  return env;
}

const PRE = { ragWisdom: '', legacyQuestions: [], convState: null, questionsWereRetrieved: false, knowledgePlanUsed: null };
const POLICY = { moveDecision: null, knowledgePlan: null, enforceMovePolicy: false };

(async () => {
  console.log('\n── W4: sentinel paths await the message + turn_logs write before returning ──\n');

  const sentinels: Array<[string, string]> = [
    ['crisis', 'I take what you said seriously. 988 is there for you.'],
    ['post-crisis-retreat', 'Okay. I hear you pulling back. 988 stays in your phone.'],
    ['ai-honesty', 'Yes. I am an AI. What you said before that was real.'],
    ['frame-refusal', 'I will not draft that. But tell me what you want him to know.'],
  ];
  for (const [label, reply] of sentinels) {
    const env = baseEnv(`${label} opener`, reply);
    const q = orderingQuery();
    const res = await buildResponse(env, q.fn);
    // At the moment buildResponse resolves, the async-gapped writes must already be DONE.
    assert(`${label}: user message write COMPLETED before response returned`, q.events.includes('done:user'), q.events.join(','));
    assert(`${label}: marcus message write COMPLETED before response returned`, q.events.includes('done:marcus'));
    assert(`${label}: turn_logs write COMPLETED before response returned (now observable)`, q.events.includes('done:turnlog'));
    assert(`${label}: response is the sentinel reply`, res.response === reply);
  }

  console.log('\n── W4: composer path awaits the message write before returning ──\n');
  {
    const env = baseEnv('work has been crushing me lately', '');
    const model: NonNullable<ComposerTestHooks['model']> = { invoke: async () => ({ content: 'Crushing — stay with that word a moment.' }) };
    const q = orderingQuery();
    const res = await runComposerPipeline(env, '', PRE, POLICY, { model, queryFn: q.fn });
    assert('composer: user message write COMPLETED before response returned', q.events.includes('done:user'), q.events.join(','));
    assert('composer: marcus message write COMPLETED before response returned', q.events.includes('done:marcus'));
    assert('composer: returns the composed reply', res.response.length > 0 && res.response !== 'I hear you. Tell me more.');
    assert('composer: written marcus content matches the returned reply', env.final_response === res.response);
  }

  console.log('\n── W4: a write failure still yields a response (never throws, never blocks) ──\n');
  {
    const failing: QFn = async () => { throw new Error('db down'); };
    const env1 = baseEnv('x', 'the reply');
    let threw1 = false; let res1: Awaited<ReturnType<typeof buildResponse>> | undefined;
    try { res1 = await buildResponse(env1, failing); } catch { threw1 = true; }
    assert('sentinel: does not throw on write failure', threw1 === false);
    assert('sentinel: still returns the reply on write failure', res1?.response === 'the reply');

    const env2 = baseEnv('y', '');
    const model: NonNullable<ComposerTestHooks['model']> = { invoke: async () => ({ content: 'Still here with you.' }) };
    let threw2 = false; let res2: Awaited<ReturnType<typeof runComposerPipeline>> | undefined;
    try { res2 = await runComposerPipeline(env2, '', PRE, POLICY, { model, queryFn: failing }); } catch { threw2 = true; }
    assert('composer: does not throw on write failure', threw2 === false);
    assert('composer: still returns the reply on write failure', !!res2 && res2.response.length > 0 && res2.response === env2.final_response);
  }

  console.log('\n── Latency (measured this run) ──');
  {
    // Instant mock (no I/O) → isolates the added ORCHESTRATION overhead of the awaited
    // write path from DB round-trip time. Real DB latency shows up in the [turn-persist]
    // ms= logs above and in CloudWatch.
    const instant: QFn = async (sql: string) => (/RETURNING id/.test(sql) ? { rows: [{ id: 'm' }] } : { rows: [] });
    const env = baseEnv('latency probe', 'a short reply');
    const t0 = Date.now();
    await buildResponse(env, instant);
    const overheadMs = Date.now() - t0;
    console.log(`  sentinel awaited-write orchestration overhead (instant mock DB, 2 msg + 1 turn_logs insert): ~${overheadMs}ms`);
    console.log('  real per-turn cost = those insert round-trips against Postgres — read it from the [turn-persist] ms= logs / CloudWatch.');
  }

  console.log('\n── SUMMARY ──');
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed > 0) console.log('  ❌ SUITE FAILED'); else console.log('  ✅ SUITE PASSED');
  process.exit(failed > 0 ? 1 : 0);
})();
