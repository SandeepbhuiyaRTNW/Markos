/**
 * W1 — composer return-path proof (no LLM, no DB).
 *
 * Concern: if the composer path returned through buildResponse (as the four sentinels
 * do), persistTurnMessages would fire TWICE per normal turn → duplicate message rows.
 *
 * This exercises a REAL composer turn through its ACTUAL return path
 * (runComposerPipeline → its own returned object) using an injected fake model + injected
 * query, and asserts EXACTLY ONE write (one user + one marcus row). If the composer also
 * routed through buildResponse, this would capture 4 message inserts, not 2.
 *
 * Run from the app root: npx tsx scripts/test-w1-composer-return-path.ts
 */
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import { runComposerPipeline, type ComposerTestHooks } from '../src/lib/agents/orchestrator-v2-composer';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

interface Call { sql: string; params: unknown[]; }

(async () => {
  const calls: Call[] = [];
  let n = 0;
  const queryFn: NonNullable<ComposerTestHooks['queryFn']> = async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    if (/RETURNING id/.test(sql)) return { rows: [{ id: `msg-${++n}` }] };
    return { rows: [] };
  };

  const MARCUS_REPLY = 'Crushing — that word. Stay with the crushing for a moment.';
  const model: NonNullable<ComposerTestHooks['model']> = {
    invoke: async () => ({ content: MARCUS_REPLY }),
  };

  const env = createStateEnvelope({
    userId: 'user-1', conversationId: 'conv-1',
    utterance: 'work has been crushing me lately',
    conversationHistory: [], userName: 'Tester',
  });

  // pre supplied → skips retrievePreComposer (no RAG / embeddings). Non-enforced policy.
  const pre = { ragWisdom: '', legacyQuestions: [], convState: null, questionsWereRetrieved: false, knowledgePlanUsed: null };
  const policy = { moveDecision: null, knowledgePlan: null, enforceMovePolicy: false };

  const result = await runComposerPipeline(env, '', pre, policy, { model, queryFn });

  // storeInBackground is fire-and-forget; give its awaited persistTurnMessages a tick to land.
  await new Promise((r) => setTimeout(r, 50));

  console.log('\n── Composer path exercised through its REAL return object ──\n');

  const msgInserts = calls.filter(c => /INSERT INTO messages/.test(c.sql));
  const userInserts = msgInserts.filter(c => /'user'/.test(c.sql));
  const marcusInserts = msgInserts.filter(c => /'marcus'/.test(c.sql));

  assert('EXACTLY one user + one marcus row written (no double write via buildResponse)',
    msgInserts.length === 2 && userInserts.length === 1 && marcusInserts.length === 1,
    `messages inserts=${msgInserts.length}`);
  assert('composer returned a real reply (not the error/absent fallback)',
    result.response.length > 0 && result.response !== 'I hear you. Tell me more.', JSON.stringify(result.response));
  assert('the written marcus row matches the returned response (one coherent write)',
    marcusInserts[0]?.params[1] === result.response && result.response === env.final_response);
  assert('the written user row is the utterance',
    userInserts[0]?.params[1] === 'work has been crushing me lately');

  console.log('\n── SUMMARY ──');
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed > 0) console.log('  ❌ SUITE FAILED'); else console.log('  ✅ SUITE PASSED');
  process.exit(failed > 0 ? 1 : 0);
})();
