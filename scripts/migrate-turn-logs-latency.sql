-- ============================================
-- MIGRATION: turn_logs latency instrumentation
-- Adds measured wall-clock + regeneration-trigger columns so latency analysis
-- is measured, not reconstructed from the per-agent stage graph.
-- Run: psql $DATABASE_URL -f scripts/migrate-turn-logs-latency.sql
-- ============================================

-- Measured wall-clock of the agent pipeline (envelope creation -> response
-- ready). Excludes route-level STT/TTS, which are not instrumented.
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS total_ms INTEGER;

-- Route-level wall-clock (entry -> response-ready, INCLUDING STT and TTS),
-- recorded by the API route after synthesis via an UPDATE on the turn row.
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS route_total_ms INTEGER;

-- Which post-generation checks forced a regeneration this turn
-- (boundary | trajectory_dedup | fantasy_identity | vocab_fidelity | forbidden_phrase).
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS regen_triggers TEXT[];

SELECT 'Migration complete -- turn_logs.total_ms and regen_triggers added' AS status;
