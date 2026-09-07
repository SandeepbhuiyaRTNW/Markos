-- ============================================
-- MIGRATION: Embodied Man interview sessions
-- Structured-interview state (phase, current section, sittings) per user.
-- Run: psql $DATABASE_URL -f scripts/migrate-interview-sessions.sql
-- ============================================

CREATE TABLE IF NOT EXISTS interview_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_id ON interview_sessions(user_id);

SELECT 'Migration complete — interview_sessions table added' AS status;
