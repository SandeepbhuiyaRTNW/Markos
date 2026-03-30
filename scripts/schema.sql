-- Drop existing tables to recreate cleanly
DROP TABLE IF EXISTS reflections CASCADE;
DROP TABLE IF EXISTS kwml_profiles CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS embeddings CASCADE;
DROP TABLE IF EXISTS memory_layers CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    cognito_sub VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    onboarding_complete BOOLEAN DEFAULT FALSE,
    profile_data JSONB DEFAULT '{}'::jsonb
);

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,
    summary TEXT,
    mood_start VARCHAR(50),
    mood_end VARCHAR(50),
    session_number INTEGER DEFAULT 1,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'marcus', 'system')),
    content TEXT NOT NULL,
    audio_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    emotion_detected VARCHAR(50),
    understanding_layer INTEGER,
    kwml_archetype VARCHAR(50),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 7-Layer Memory System
CREATE TABLE memory_layers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    layer_number INTEGER NOT NULL CHECK (layer_number BETWEEN 1 AND 7),
    layer_name VARCHAR(100) NOT NULL,
    key VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    confidence FLOAT DEFAULT 0.5,
    source_message_id UUID REFERENCES messages(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Embeddings table for RAG
CREATE TABLE embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content TEXT NOT NULL,
    embedding vector(3072),
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('book', 'question', 'conversation', 'reflection')),
    source_id VARCHAR(255),
    source_title VARCHAR(500),
    chunk_index INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Questions table
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_text TEXT NOT NULL,
    archetype VARCHAR(50),
    shadow VARCHAR(50),
    function VARCHAR(50),
    depth_level INTEGER,
    arena VARCHAR(100),
    risk_polarity VARCHAR(50),
    emotion_context VARCHAR(100),
    perma_domain VARCHAR(50),
    trust_level VARCHAR(50),
    effectiveness_score FLOAT,
    metadata JSONB DEFAULT '{}'::jsonb,
    embedding vector(3072)
);

-- KWML Profiles
CREATE TABLE kwml_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    king_score FLOAT DEFAULT 0,
    warrior_score FLOAT DEFAULT 0,
    magician_score FLOAT DEFAULT 0,
    lover_score FLOAT DEFAULT 0,
    king_shadow VARCHAR(50),
    warrior_shadow VARCHAR(50),
    magician_shadow VARCHAR(50),
    lover_shadow VARCHAR(50),
    dominant_archetype VARCHAR(50),
    shadow_active BOOLEAN DEFAULT FALSE,
    assessed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    conversation_id UUID REFERENCES conversations(id),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Daily reflections
CREATE TABLE reflections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id),
    reflection_text TEXT,
    marcus_response TEXT,
    stoic_principle VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- B-tree indexes
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_memory_layers_user_id ON memory_layers(user_id);
CREATE INDEX idx_memory_layers_layer ON memory_layers(user_id, layer_number);
CREATE INDEX idx_embeddings_source ON embeddings(source_type);
CREATE INDEX idx_questions_archetype ON questions(archetype);
CREATE INDEX idx_questions_function ON questions(function);
CREATE INDEX idx_kwml_profiles_user_id ON kwml_profiles(user_id);
CREATE INDEX idx_reflections_user_id ON reflections(user_id);

-- Vector similarity search indexes (IVFFlat) - these require data to exist first
-- Run these AFTER loading embeddings data:
-- CREATE INDEX idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX idx_questions_vector ON questions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

SELECT 'Schema created successfully - all 8 tables and indexes' AS status;
