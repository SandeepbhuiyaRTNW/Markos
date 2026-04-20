/**
 * Turn Logger — Clinical Observability (§12)
 * Logs the full turn trace for each conversation turn.
 * Used for: clinical governance dashboard, conversation review, debugging.
 *
 * Stored in a `turn_logs` table for queryable observability.
 */

import type { StateEnvelope } from '../agents/state-envelope';
import { query } from '../db';

/** Ensure the turn_logs table exists */
export async function ensureTurnLogsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS turn_logs (
      id SERIAL PRIMARY KEY,
      turn_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(100) NOT NULL,
      conversation_id VARCHAR(100) NOT NULL,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      utterance TEXT,
      final_response TEXT,

      -- Sentinel outputs
      crisis_level VARCHAR(20),
      crisis_type VARCHAR(50),
      boundary_violations TEXT[],

      -- Assessment Ring
      phase VARCHAR(20),
      phase_confidence REAL,
      archetype VARCHAR(50),
      shadow VARCHAR(50),
      trust_cognitive REAL,
      trust_affective REAL,
      silence_type VARCHAR(30),
      silence_confidence REAL,
      arena_primary VARCHAR(50),
      arena_weights JSONB,

      -- Wisdom + Whisperers
      wisdom_voices TEXT[],
      whisperers_invoked TEXT[],
      frameworks_applied TEXT[],

      -- Craft
      craft_form VARCHAR(20),
      craft_pacing VARCHAR(20),

      -- Performance
      agent_timings JSONB,
      errors JSONB,

      -- Cultural
      register VARCHAR(20),
      faith_context VARCHAR(30),

      -- Pathway
      pathway_candidates JSONB
    )
  `).catch(() => {});

  // Index for fast queries
  await query(`CREATE INDEX IF NOT EXISTS idx_turn_logs_user ON turn_logs(user_id)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_turn_logs_conv ON turn_logs(conversation_id)`).catch(() => {});
  await query(`CREATE INDEX IF NOT EXISTS idx_turn_logs_crisis ON turn_logs(crisis_level) WHERE crisis_level != 'none'`).catch(() => {});
}

/** Log a completed turn to the turn_logs table */
export async function logTurn(env: StateEnvelope): Promise<void> {
  try {
    await query(
      `INSERT INTO turn_logs (
        turn_id, user_id, conversation_id, utterance, final_response,
        crisis_level, crisis_type, boundary_violations,
        phase, phase_confidence, archetype, shadow,
        trust_cognitive, trust_affective,
        silence_type, silence_confidence,
        arena_primary, arena_weights,
        wisdom_voices, whisperers_invoked, frameworks_applied,
        craft_form, craft_pacing,
        agent_timings, errors,
        register, faith_context, pathway_candidates
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14,
        $15, $16,
        $17, $18,
        $19, $20, $21,
        $22, $23,
        $24, $25,
        $26, $27, $28
      )`,
      [
        env.turn_id, env.user_id, env.conversation_id,
        env.utterance, env.final_response,
        env.sentinels.crisis.level, env.sentinels.crisis.type,
        env.sentinels.boundary.violations_found,
        env.assessment.phase.label, env.assessment.phase.confidence,
        env.assessment.archetype?.active || null, env.assessment.archetype?.shadow || null,
        env.assessment.trust.cognitive, env.assessment.trust.affective,
        env.assessment.silence_type?.label || null, env.assessment.silence_type?.confidence || null,
        env.assessment.arena?.primary || null,
        env.assessment.arena?.weights ? JSON.stringify(env.assessment.arena.weights) : null,
        env.wisdom_council.invoked,
        env.domain_whisperers.invoked,
        env.domain_whisperers.frameworks_applied,
        env.craft_directives.form, env.craft_directives.pacing,
        JSON.stringify(env.agent_timings),
        env.errors.length > 0 ? JSON.stringify(env.errors) : null,
        env.sentinels.cultural.register, env.sentinels.cultural.faith_context,
        env.sentinels.pathway_router.candidates.length > 0
          ? JSON.stringify(env.sentinels.pathway_router.candidates) : null,
      ]
    );
  } catch (err) {
    console.error('[TurnLogger] Failed to log turn:', err);
  }
}

/** Get crisis events for a user (for clinical dashboard) */
export async function getCrisisEvents(userId: string): Promise<Array<{
  turn_id: string; timestamp: string; crisis_level: string; crisis_type: string;
  utterance: string; final_response: string;
}>> {
  const result = await query(
    `SELECT turn_id, timestamp, crisis_level, crisis_type, utterance, final_response
     FROM turn_logs WHERE user_id = $1 AND crisis_level != 'none'
     ORDER BY timestamp DESC LIMIT 50`,
    [userId]
  );
  return result.rows;
}

/** Get archetype path for a user (for KWML journey tracking) */
export async function getArchetypePath(userId: string, limit: number = 20): Promise<Array<{
  timestamp: string; archetype: string; shadow: string; phase: string;
}>> {
  const result = await query(
    `SELECT timestamp, archetype, shadow, phase
     FROM turn_logs WHERE user_id = $1 AND archetype IS NOT NULL
     ORDER BY timestamp DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

