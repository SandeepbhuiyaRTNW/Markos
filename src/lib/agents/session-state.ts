/**
 * Session State — per-conversation persistence of trust + phase (W2 fix).
 *
 * Before this module, every turn rebuilt trust and phase from scratch:
 * `computeTrust` was called without its `existingTrust` argument and the
 * envelope factory hardcoded a fresh seed, so turn 3 could feel like turn 1.
 * The trust a man had earned — and the phase he had reached — evaporated
 * between turns, and pacing whiplashed with whatever his latest message
 * scored.
 *
 * State lives in `conversations.metadata->'conversation_state'` (JSONB), so
 * NO schema migration is required. Shape:
 *   { "trust": { "cognitive": 0.0-1.0, "affective": 0.0-1.0 },
 *     "phase": "unsilenced" | "unleashed" | "brothered",
 *     "updated_at": ISO string }
 *
 * Both functions NEVER throw: a state hiccup must never break a turn. A
 * failed load just means one more stateless turn (the old behavior); a failed
 * save means one turn of staleness. Failures are logged loudly with the
 * conversation id so they are traceable.
 */

import type { QueryFn } from './persist-messages';
import type { TrustOutput, Phase } from './state-envelope';

export interface SessionState {
  trust: TrustOutput | null;
  phase: Phase | null;
}

const VALID_PHASES: readonly string[] = ['unsilenced', 'unleashed', 'brothered'];

function clamp01(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/** Load persisted trust + phase for a conversation. Returns nulls when absent/invalid. */
export async function loadSessionState(queryFn: QueryFn, conversationId: string): Promise<SessionState> {
  try {
    const result = await queryFn(
      `SELECT metadata->'conversation_state' AS state FROM conversations WHERE id = $1`,
      [conversationId],
    );
    const raw = (result.rows[0] as unknown as { state?: unknown })?.state;
    if (!raw || typeof raw !== 'object') return { trust: null, phase: null };
    const state = raw as { trust?: { cognitive?: unknown; affective?: unknown }; phase?: unknown };
    const cognitive = clamp01(state.trust?.cognitive);
    const affective = clamp01(state.trust?.affective);
    const trust: TrustOutput | null = cognitive !== null && affective !== null ? { cognitive, affective } : null;
    const phase: Phase | null = typeof state.phase === 'string' && VALID_PHASES.includes(state.phase)
      ? (state.phase as Phase)
      : null;
    return { trust, phase };
  } catch (err) {
    console.error(`[session-state] FAILED to load state — conversation_id=${conversationId}:`, err);
    return { trust: null, phase: null };
  }
}

/**
 * Persist the turn's trust + phase for the NEXT turn. Fire-and-forget safe
 * (never throws) but exported as awaitable so the orchestrator can overlap it
 * with the whisperer/composer pre-fetch at zero added latency.
 */
export async function saveSessionState(
  queryFn: QueryFn,
  conversationId: string,
  trust: TrustOutput,
  phase: Phase,
): Promise<boolean> {
  try {
    const payload = JSON.stringify({
      trust: { cognitive: trust.cognitive, affective: trust.affective },
      phase,
      updated_at: new Date().toISOString(),
    });
    await queryFn(
      `UPDATE conversations
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{conversation_state}', $2::jsonb, true)
       WHERE id = $1`,
      [conversationId, payload],
    );
    return true;
  } catch (err) {
    console.error(`[session-state] FAILED to save state — conversation_id=${conversationId}:`, err);
    return false;
  }
}
