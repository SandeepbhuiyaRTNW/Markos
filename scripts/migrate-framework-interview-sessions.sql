-- ============================================
-- MIGRATION: Framework interview sessions
-- Structured-interview state (phase, answers, skips, sittings) per user for
-- the optional onboarding framework interview.
-- Run: psql $DATABASE_URL -f scripts/migrate-framework-interview-sessions.sql
-- NOTE: not yet tested against a live database — same posture as
-- migrate-interview-sessions.sql when it landed.
-- ============================================

-- FK cascades on user deletion. NOTE: /api/auth/clean-slate keeps the users row,
-- so it must DELETE FROM framework_interview_sessions explicitly — the cascade
-- won't fire there (handled in src/app/api/auth/clean-slate/route.ts).
CREATE TABLE IF NOT EXISTS framework_interview_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_framework_interview_sessions_user_id ON framework_interview_sessions(user_id);

SELECT 'Migration complete — framework_interview_sessions table added' AS status;
