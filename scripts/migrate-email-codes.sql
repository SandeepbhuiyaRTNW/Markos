-- ============================================
-- MIGRATION: Email verification codes table
-- Run: psql $DATABASE_URL -f scripts/migrate-email-codes.sql
-- ============================================

CREATE TABLE IF NOT EXISTS email_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(320) NOT NULL,
    code VARCHAR(6) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_codes_lookup ON email_codes(email, code, used);

SELECT 'Migration complete — email_codes table created' AS status;

