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
      total_ms INTEGER,
      route_total_ms INTEGER,
      regen_triggers TEXT[],
      errors JSONB,

      -- Cultural
      register VARCHAR(20),
      faith_context VARCHAR(30),

      -- Pathway
      pathway_candidates JSONB
    )
  `).catch(() => {});

  // Policy-layer columns added for move-selector/knowledge-intelligence observability.
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_enforced BOOLEAN`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_move TEXT`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_move_rule TEXT`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_asked_question BOOLEAN`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_selected_form TEXT`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_too_early_to_address TEXT[]`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_knowledge_rule TEXT`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_knowledge_safety_only BOOLEAN`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_knowledge_questions_enabled BOOLEAN`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_knowledge_question_scopes JSONB`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_excluded_domains TEXT[]`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_final_form TEXT`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_final_question_count INT`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_questions_were_retrieved BOOLEAN`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_question_candidates_passed BOOLEAN`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_move_conflict BOOLEAN`).catch(() => {});
  await query(`ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS policy_no_question_override_active BOOLEAN`).catch(() => {});

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
        register, faith_context, pathway_candidates,
        total_ms, regen_triggers,
        policy_enforced, policy_move, policy_move_rule, policy_asked_question, policy_selected_form,
        policy_too_early_to_address, policy_knowledge_rule, policy_knowledge_safety_only,
        policy_knowledge_questions_enabled, policy_knowledge_question_scopes, policy_excluded_domains,
        policy_final_form, policy_final_question_count, policy_questions_were_retrieved,
        policy_question_candidates_passed, policy_move_conflict, policy_no_question_override_active
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
        $26, $27, $28,
        $29, $30,
        $31, $32, $33, $34,
        $35, $36, $37,
        $38, $39, $40,
        $41, $42, $43,
        $44, $45, $46
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
        env.total_ms,
        env.regen_triggers.length > 0 ? env.regen_triggers : null,
        env.policy_diagnostics.enforced,
        env.move_decision?.move || null,
        env.policy_diagnostics.move_rule,
        env.policy_diagnostics.asked_question,
        env.policy_diagnostics.selected_form,
        env.policy_diagnostics.too_early_to_address.length > 0
          ? env.policy_diagnostics.too_early_to_address
          : null,
        env.policy_diagnostics.knowledge_rule,
        env.policy_diagnostics.knowledge_safety_only,
        env.policy_diagnostics.questions_enabled,
        env.knowledge_plan?.questions
          ? JSON.stringify({
            whispererScope: env.knowledge_plan.questions.whispererScope,
            arenaScope: env.knowledge_plan.questions.arenaScope,
          })
          : null,
        env.knowledge_plan?.wisdom.excludeDomains?.length ? env.knowledge_plan.wisdom.excludeDomains : null,
        env.policy_diagnostics.final_form,
        env.policy_diagnostics.final_question_count,
        env.policy_diagnostics.questions_were_retrieved,
        env.policy_diagnostics.question_candidates_passed,
        env.policy_diagnostics.move_conflict,
        env.policy_diagnostics.no_question_override_active,
      ]
    );
  } catch (err) {
    console.error('[TurnLogger] Failed to log turn:', err);
  }
}

/**
 * Record the route-level wall-clock (entry -> response-ready, INCLUDING STT and
 * TTS) onto the turn row the Composer already inserted for this turn. Called
 * from the API route after synthesis. On the voice path the intervening TTS
 * await guarantees the Composer's fire-and-forget insert has landed; on the
 * text path (no TTS) it is best-effort and may occasionally find no row yet.
 */
export async function recordRouteTotal(turnId: string, routeTotalMs: number): Promise<void> {
  try {
    const result = await query(`UPDATE turn_logs SET route_total_ms = $2 WHERE turn_id = $1`, [turnId, routeTotalMs]);
    // The Composer awaits its logTurn insert before processMessage returns, so
    // the row must already exist here. A miss means that ordering guarantee
    // regressed — surface it loudly rather than dropping route_total_ms silently.
    if (result.rowCount === 0) {
      console.warn(`[TurnLogger] route_total_ms: no turn_logs row for turn_id=${turnId} (insert ordering regressed?)`);
    }
  } catch (err) {
    console.error('[TurnLogger] Failed to record route_total_ms:', err);
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
