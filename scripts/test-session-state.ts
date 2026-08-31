/**
 * Session-state + naturalness fixes — deterministic tests (no DB, no LLM).
 * Run: npx tsx scripts/test-session-state.ts
 *
 * Covers the three "feels natural" fixes:
 *   W2  — trust carries across turns; phase never regresses (monotonicPhase)
 *   W3/W5/W6 — push depth clamped to one step past presented depth; forced
 *              silence-question demoted to a candidate; depth mandate softened
 *   W13 — the composer receives the opener's continuity anchors
 *   session-state load/save SQL shape + defensive parsing (fake queryFn, no DB)
 */

import { monotonicPhase, PHASE_ORDER } from '../src/lib/assessment/phase-mapper';
import { computeTrust } from '../src/lib/assessment/trust-gauge';
import { buildPriorityHierarchy, computeChallengeCeiling } from '../src/lib/agents/orchestrator-v2-composer';
import { loadSessionState, saveSessionState } from '../src/lib/agents/session-state';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import type { ListenerStackOutput } from '../src/lib/agents/state-envelope';
import type { QueryFn } from '../src/lib/agents/persist-messages';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n── W2: phase never regresses ──');
assert('unsilenced -> unsilenced stays', monotonicPhase({ label: 'unsilenced', confidence: 0.9 }, null).label === 'unsilenced');
assert('computed unleashed advances', monotonicPhase({ label: 'unleashed', confidence: 0.7 }, 'unsilenced').label === 'unleashed');
assert('persisted unleashed floors a shallow computed turn', monotonicPhase({ label: 'unsilenced', confidence: 0.6 }, 'unleashed').label === 'unleashed');
assert('persisted brothered floors everything', monotonicPhase({ label: 'unsilenced', confidence: 0.9 }, 'brothered').label === 'brothered');
assert('computed brothered still advances past unleashed', monotonicPhase({ label: 'brothered', confidence: 0.8 }, 'unleashed').label === 'brothered');
assert('unknown persisted value ignored', monotonicPhase({ label: 'unsilenced', confidence: 0.5 }, 'nonsense' as never).label === 'unsilenced');
assert('PHASE_ORDER strictly increases', PHASE_ORDER.unsilenced < PHASE_ORDER.unleashed && PHASE_ORDER.unleashed < PHASE_ORDER.brothered);

console.log('\n── W2: trust carries forward ──');
const cold = computeTrust('work is busy', [], 0, null);
const carried = computeTrust('work is busy', [], 0, { cognitive: 0.62, affective: 0.41 });
assert('existingTrust replaces the session-count seed', Math.abs(carried.cognitive - 0.62) < 0.001 && Math.abs(carried.affective - 0.41) < 0.001,
  `got cog=${carried.cognitive} aff=${carried.affective}`);
const grown = computeTrust('i never told anyone this', [], 0, { cognitive: 0.62, affective: 0.41 });
assert('signals still accrue on top of carried trust', grown.affective > carried.affective, `aff ${carried.affective} -> ${grown.affective}`);

console.log('\n── W3: push ceiling = min(phase max, presented + 1) ──');
assert('shallow turn under unleashed caps at 2', computeChallengeCeiling(4, 1) === 2);
assert('deep presented clamps to phase max', computeChallengeCeiling(3, 5) === 3);
assert('presented 4 under brothered allows 5', computeChallengeCeiling(5, 4) === 5);
assert('presented 0 still floors at 1', computeChallengeCeiling(3, 0) === 1);

console.log('\n── W5/W6: softened composer directives ──');
function envWith(over: Partial<ListenerStackOutput> = {}): ReturnType<typeof createStateEnvelope> {
  const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance: 'work is busy', conversationHistory: [], userName: null });
  env.sentinels.listener_stack = {
    words: '', emotion: '', pattern: '', the_man: '', the_silence: '', depth_level: 1,
    depth_opportunity: '', silence_question: '', emotional_trajectory: 'neutral', primary_emotion: 'neutral',
    ...over,
  };
  return env;
}
const shallow = buildPriorityHierarchy(envWith({ depth_level: 1, silence_question: 'what are you most afraid of?' }));
assert('no more "YOU are failing" pressure', !shallow.includes('YOU are failing'));
assert('depth move is gated on him opening a door', shallow.includes('opened a door'));
assert('silence question demoted to candidate', shallow.includes('a candidate, not a command'));
assert('silence question text still present when allowed', shallow.includes('what are you most afraid of?'));
const deep = buildPriorityHierarchy(envWith({ depth_level: 4 }));
assert('sacred-ground branch unchanged at depth 4', deep.includes('sacred ground'));

console.log('\n── W13: continuity field exists on the envelope ──');
{
  const env = createStateEnvelope({ userId: 'u', conversationId: 'c', utterance: 'x', conversationHistory: [], userName: null });
  assert('last_session_continuity defaults to null', env.sentinels.memory.last_session_continuity === null);
}

console.log('\n── session-state: load/save (fake queryFn, no DB) ──');
async function main() {
  const saved: { sql?: string; params?: unknown[] } = {};
  const capture: QueryFn = async (text, params) => { saved.sql = text; saved.params = params; return { rows: [] }; };
  const ok = await saveSessionState(capture, 'conv-1', { cognitive: 0.6, affective: 0.4 }, 'unleashed');
  assert('save returns true on success', ok === true);
  assert('save targets conversations.metadata JSONB', !!saved.sql && saved.sql.includes('jsonb_set') && saved.sql.includes('conversation_state'));
  assert('save param carries trust + phase', typeof saved.params?.[1] === 'string'
    && (saved.params[1] as string).includes('"cognitive":0.6') && (saved.params[1] as string).includes('"phase":"unleashed"'));

  const goodLoad = (async () => ({ rows: [{ state: { trust: { cognitive: 0.55, affective: 0.33 }, phase: 'unleashed' } }] })) as unknown as QueryFn;
  const loaded = await loadSessionState(goodLoad, 'conv-1');
  assert('load round-trips trust + phase', loaded.trust?.cognitive === 0.55 && loaded.trust?.affective === 0.33 && loaded.phase === 'unleashed');

  const emptyLoad = (async () => ({ rows: [{ state: null }] })) as unknown as QueryFn;
  assert('load with no state returns nulls', JSON.stringify(await loadSessionState(emptyLoad, 'conv-1')) === JSON.stringify({ trust: null, phase: null }));

  const garbageLoad = (async () => ({ rows: [{ state: { trust: { cognitive: 'high' }, phase: 'enlightened' } }] })) as unknown as QueryFn;
  assert('load with invalid values returns nulls', JSON.stringify(await loadSessionState(garbageLoad, 'conv-1')) === JSON.stringify({ trust: null, phase: null }));

  const failing: QueryFn = async () => { throw new Error('db down'); };
  assert('load never throws on DB failure', JSON.stringify(await loadSessionState(failing, 'conv-1')) === JSON.stringify({ trust: null, phase: null }));
  assert('save never throws on DB failure', (await saveSessionState(failing, 'conv-1', { cognitive: 0.1, affective: 0.1 }, 'unsilenced')) === false);
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
