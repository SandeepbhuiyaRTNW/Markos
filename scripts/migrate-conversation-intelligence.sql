-- ============================================
-- MIGRATION: Conversation Intelligence layer
-- Understands each conversation as an event in the user's life (emotional arc,
-- people, open loops, follow-ups, vocabulary growth) ON TOP OF the existing
-- 7-layer memory_layers fact store. Additive only — does not touch existing
-- tables. Run: psql $DATABASE_URL -f scripts/migrate-conversation-intelligence.sql
-- ============================================

-- One row per conversation: the conversation-as-event snapshot.
CREATE TABLE IF NOT EXISTS conversation_intelligence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    headline TEXT,
    emotional_arc JSONB NOT NULL DEFAULT '[]'::jsonb,      -- [{turn, emotion, depth, silence_type, arena}] appended every turn
    people JSONB NOT NULL DEFAULT '[]'::jsonb,             -- [{name, relationship, sentiment, note}] (LLM snapshot)
    vocabulary_moments JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{from, to, quote}] NMA -> named-emotion growth
    what_changed TEXT,                                    -- vs how he usually talks about this
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Many per user: unresolved threads that Marcus can return to.
CREATE TABLE IF NOT EXISTS open_loops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opened_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dormant')),
    salience FLOAT NOT NULL DEFAULT 0.5,
    people JSONB NOT NULL DEFAULT '[]'::jsonb,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_session INTEGER,                            -- session_number when last referenced (for dormancy)
    resolved_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Many per user: concrete "ask about X next time" opportunities.
CREATE TABLE IF NOT EXISTS follow_ups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opened_conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    open_loop_id UUID REFERENCES open_loops(id) ON DELETE SET NULL,
    prompt TEXT NOT NULL,
    trigger VARCHAR(20) NOT NULL DEFAULT 'next_session' CHECK (trigger IN ('next_session', 'time', 'event')),
    due_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'surfaced', 'done', 'dropped')),
    value FLOAT NOT NULL DEFAULT 0.5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    surfaced_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversation_intelligence_user ON conversation_intelligence(user_id);
CREATE INDEX IF NOT EXISTS idx_open_loops_user_status ON open_loops(user_id, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_user_status ON follow_ups(user_id, status);

SELECT 'Migration complete -- conversation_intelligence, open_loops, follow_ups added' AS status;
