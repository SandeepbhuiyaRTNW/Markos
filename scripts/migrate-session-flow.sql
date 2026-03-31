-- ============================================
-- MIGRATION: Dashboard & Session Flow Enhancements
-- Adds session lifecycle support (end session, takeaways, pondering)
-- Run: psql $DATABASE_URL -f scripts/migrate-session-flow.sql
-- Rollback: psql $DATABASE_URL -f scripts/rollback.sql
-- ============================================

-- 1. Add session lifecycle columns to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_ended BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS takeaways JSONB DEFAULT '[]'::jsonb;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pondering_topics JSONB DEFAULT '[]'::jsonb;

-- 2. Create session_notes table for detailed end-of-session reports
CREATE TABLE IF NOT EXISTS session_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    summary TEXT,
    takeaways JSONB DEFAULT '[]'::jsonb,
    pondering_topics JSONB DEFAULT '[]'::jsonb,
    emotion_arc JSONB DEFAULT '[]'::jsonb,
    stoic_principle TEXT,
    title VARCHAR(255),
    mood VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_notes_user_id ON session_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_session_notes_conversation_id ON session_notes(conversation_id);

SELECT 'Migration complete — session flow columns and session_notes table added' AS status;

