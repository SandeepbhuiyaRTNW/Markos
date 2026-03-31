-- ============================================
-- CLEAN OLD CONVERSATIONS
-- Removes all conversation data (messages, sessions, memories, KWML profiles)
-- PRESERVES: users table, embeddings (books), questions
-- ============================================

-- Safety: Show what will be deleted
SELECT 'Conversations to delete:' AS info, COUNT(*) AS count FROM conversations;
SELECT 'Messages to delete:' AS info, COUNT(*) AS count FROM messages;
SELECT 'Memory layers to delete:' AS info, COUNT(*) AS count FROM memory_layers;
SELECT 'KWML profiles to delete:' AS info, COUNT(*) AS count FROM kwml_profiles;
SELECT 'Reflections to delete:' AS info, COUNT(*) AS count FROM reflections;

-- Delete in dependency order (children first)
DELETE FROM reflections;
DELETE FROM kwml_profiles;
DELETE FROM memory_layers;
DELETE FROM messages;
DELETE FROM conversations;

-- Reset session numbers will happen naturally with new conversations

SELECT 'Clean complete — all conversation data removed. Users and embeddings preserved.' AS status;

