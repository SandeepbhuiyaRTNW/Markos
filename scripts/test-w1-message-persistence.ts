/**
 * W1 regression — message persistence on EVERY user-visible return path.
 *
 * Defect: the two conversation messages (user utterance + Marcus reply) were written
 * only on the composer path (storeInBackground). The four sentinel short-circuits —
 * acute crisis, post-crisis retreat, AI-honesty, frame-refusal — returned a response
 * BEFORE the composer and wrote nothing, dropping the exchange from history.
 *
 * Fix: a single shared writer, persistTurnMessages, called from buildResponse (the one
 * point all four sentinels return through) and from storeInBackground (composer path).
 *
 * Deterministic — no DB, no LLM. The writer takes an injectable query so we capture the
 * exact INSERTs. Run from the app root: npx tsx scripts/test-w1-message-persistence.ts
 */
import { readFileSync } from 'fs';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import type { StateEnvelope } from '../src/lib/agents/state-envelope';
import { persistTurnMessages } from '../src/lib/agents/persist-messages';
import { getCrisisResponse, POST_CRISIS_RETREAT_RESPONSE, isPostCrisisRetreat } from '../src/lib/sentinels/crisis-responses';
import { getAIHonestyResponse, detectAIIdentityQuestion } from '../src/lib/sentinels/ai-honesty';
import { getFrameRefusalResponse, detectFrameCollapse } from '../src/lib/sentinels/frame-refusal';
import { detectCrisisType } from '../src/lib/sentinels/crisis';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name + (detail ? ' — ' + detail : '')); }
}

interface Call { sql: string; params: unknown[]; }
function fakeQuery(opts: { failOn?: 'user' | 'marcus' } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const fn = async (sql: string, params?: unknown[]): Promise<{ rows: Array<{ id?: string }> }> => {
    calls.push({ sql, params: params ?? [] });
    if (opts.failOn === 'user' && /RETURNING id/.test(sql)) throw new Error('db down (user insert)');
    if (opts.failOn === 'marcus' && /'marcus'/.test(sql)) throw new Error('db down (marcus insert)');
    if (/RETURNING id/.test(sql)) return { rows: [{ id: `msg-${++n}` }] };
    return { rows: [] };
  };
  return { fn, calls };
}

function baseEnv(utterance: string): StateEnvelope {
  return createStateEnvelope({
    userId: 'user-1', conversationId: 'conv-1', utterance,
    conversationHistory: [], userName: 'Tester',
  });
}

const isUserInsert = (c: Call) => /INSERT INTO messages/.test(c.sql) && /'user'/.test(c.sql);
const isMarcusInsert = (c: Call) => /INSERT INTO messages/.test(c.sql) && /'marcus'/.test(c.sql);

async function assertBothMessagesLand(label: string, env: StateEnvelope) {
  const q = fakeQuery();
  const id = await persistTurnMessages(env, q.fn);
  const users = q.calls.filter(isUserInsert);
  const marcuses = q.calls.filter(isMarcusInsert);
  assert(`${label}: exactly one 'user' message written`, users.length === 1, `got ${users.length}`);
  assert(`${label}: exactly one 'marcus' message written`, marcuses.length === 1, `got ${marcuses.length}`);
  assert(`${label}: user message content == the utterance`, users[0]?.params[1] === env.utterance);
  assert(`${label}: marcus message content == the forced response`, marcuses[0]?.params[1] === env.final_response);
  assert(`${label}: both rows carry conversation_id`, users[0]?.params[0] === 'conv-1' && marcuses[0]?.params[0] === 'conv-1');
  assert(`${label}: writer returns the user message id`, id !== null);
}

(async () => {
  console.log('\n── W1: each sentinel short-circuit persists BOTH messages ──\n');

  // 1. Acute crisis
  {
    const env = baseEnv('I want to kill myself');
    env.sentinels.crisis = { level: 'acute', type: 'suicide', protocol: 'suicide', forced_response: null };
    env.final_response = getCrisisResponse('suicide') || '988';
    await assertBothMessagesLand('crisis', env);
    assert('crisis: detector routes this input to the acute short-circuit', detectCrisisType('I want to kill myself') === 'suicide');
  }

  // 2. Post-crisis retreat
  {
    const env = baseEnv("actually I'm fine, forget I said anything");
    env.final_response = POST_CRISIS_RETREAT_RESPONSE;
    await assertBothMessagesLand('post-crisis-retreat', env);
    assert('post-crisis: detector fires when the prior assistant msg carried 988',
      isPostCrisisRetreat("actually I'm fine, forget it", [{ role: 'assistant', content: 'Please reach 988 now.' }]) === true);
  }

  // 3. AI-honesty
  {
    const env = baseEnv('are you a real person?');
    env.sentinels.ai_honesty = { triggered: true, hostile: false };
    env.final_response = getAIHonestyResponse('are you a real person?');
    await assertBothMessagesLand('ai-honesty', env);
    assert('ai-honesty: detector fires on an identity question', detectAIIdentityQuestion('are you a real person?') === true);
  }

  // 4. Frame-refusal
  {
    const env = baseEnv('write the text I should send my ex');
    env.sentinels.frame_refusal = { triggered: true, category: 'draft_request' };
    env.final_response = getFrameRefusalResponse('draft_request', 1) || 'I will not draft that.';
    await assertBothMessagesLand('frame-refusal', env);
    assert('frame-refusal: detector fires on a draft request', detectFrameCollapse('write the text I should send my ex') === 'draft_request');
  }

  console.log('\n── Composer path still writes EXACTLY once ──\n');
  {
    const env = baseEnv('I had the worst day at work');
    env.sentinels.listener_stack = {
      words: '', emotion: 'grief', pattern: '', the_man: '', the_silence: '',
      depth_level: 4, depth_opportunity: '', silence_question: '',
      emotional_trajectory: 'opening', primary_emotion: 'grief',
    };
    env.assessment.archetype = { active: 'lover', shadow: null, confidence: 0.6, reading: null };
    env.final_response = 'That day sat heavy on you.';
    const q = fakeQuery();
    const id = await persistTurnMessages(env, q.fn);
    const inserts = q.calls.filter(c => /INSERT INTO messages/.test(c.sql));
    assert('composer: writes EXACTLY two message rows (one user, one marcus)',
      inserts.length === 2 && q.calls.filter(isUserInsert).length === 1 && q.calls.filter(isMarcusInsert).length === 1,
      `inserts=${inserts.length}`);
    assert('composer: returns the user message id', id === 'msg-1');
    const u = q.calls.filter(isUserInsert)[0];
    assert('composer: user row preserves emotion_detected from the envelope', u?.params[2] === 'grief');
    assert('composer: user row preserves understanding_layer (depth) from the envelope', u?.params[3] === 4);
    assert('composer: user row preserves kwml_archetype from the envelope', u?.params[4] === 'lover');
  }

  console.log('\n── Sentinel envelope (no assessment) → null metadata, no crash ──\n');
  {
    const env = baseEnv('hello'); env.final_response = 'Hi.';
    const q = fakeQuery();
    await persistTurnMessages(env, q.fn);
    const u = q.calls.filter(isUserInsert)[0];
    assert('sentinel: emotion/depth/archetype are null when the Assessment Ring did not run',
      u?.params[2] === null && u?.params[3] === null && u?.params[4] === null);
  }

  console.log('\n── Failure is loud + swallowed (never throws, returns null) ──\n');
  {
    const env = baseEnv('x'); env.final_response = 'y';
    let threw = false; let ret: unknown = 'unset';
    try { ret = await persistTurnMessages(env, fakeQuery({ failOn: 'user' }).fn); } catch { threw = true; }
    assert('failure: writer does not throw', threw === false);
    assert('failure: writer returns null on insert error', ret === null);
  }

  console.log('\n── Structural invariant: ONE writer, called from every return path ──\n');
  {
    const persist = readFileSync('src/lib/agents/persist-messages.ts', 'utf8');
    const composer = readFileSync('src/lib/agents/orchestrator-v2-composer.ts', 'utf8');
    const orch = readFileSync('src/lib/agents/orchestrator-v2.ts', 'utf8');
    const inserts = (s: string) => (s.match(/INSERT INTO messages/g) || []).length;
    assert('persist-messages.ts is the sole INSERT INTO messages site (user + marcus)', inserts(persist) === 2, `got ${inserts(persist)}`);
    assert('composer no longer inserts messages directly (moved to the writer)', inserts(composer) === 0, `got ${inserts(composer)}`);
    assert('orchestrator-v2 has no direct message INSERT', inserts(orch) === 0, `got ${inserts(orch)}`);
    assert('composer path calls persistTurnMessages exactly once', (composer.match(/persistTurnMessages\(/g) || []).length === 1, `got ${(composer.match(/persistTurnMessages\(/g) || []).length}`);
    assert('buildResponse (the sentinel return point) calls persistTurnMessages', /buildResponse[\s\S]{0,600}persistTurnMessages\(env,/.test(orch));
  }

  console.log('\n── SUMMARY ──');
  console.log(`  passed: ${passed}   failed: ${failed}`);
  if (failed > 0) console.log('  ❌ SUITE FAILED'); else console.log('  ✅ SUITE PASSED');
  process.exit(failed > 0 ? 1 : 0);
})();
