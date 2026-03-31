-- ============================================
-- ROLLBACK SCRIPT — Reverses all dashboard/session-flow changes
-- Run this to undo schema modifications if needed
-- Usage: psql $DATABASE_URL -f scripts/rollback.sql
-- ============================================

-- 1. Drop new columns added to conversations table
ALTER TABLE conversations DROP COLUMN IF EXISTS takeaways;
ALTER TABLE conversations DROP COLUMN IF EXISTS pondering_topics;
ALTER TABLE conversations DROP COLUMN IF EXISTS session_ended;

-- 2. Drop new session_notes table if created
DROP TABLE IF EXISTS session_notes CASCADE;

-- Note: This does NOT restore deleted conversation data.
-- If you need to restore data, use the backup created before deletion.

SELECT 'Rollback complete — schema changes reversed' AS status;

