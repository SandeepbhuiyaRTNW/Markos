# Marcus / mrkos.ai — Backend Documentation

The backend is a set of **Next.js 16 App Router route handlers** under `src/app/api/**`, backed by
**PostgreSQL + pgvector** (AWS RDS), the OpenAI/LangChain AI pipeline (see [AI.md](AI.md)),
**OpenAI Whisper** (STT), **ElevenLabs** (TTS), and **AWS SES** (email OTP). There is no separate
server process — every backend concern runs inside Next API routes.

> Related: [OVERVIEW.md](OVERVIEW.md) · [AI.md](AI.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 1. API routes (`src/app/api/**`)

There are 13 route handlers. All are Node runtime (they use `pg`).

### 1.1 Auth

#### `POST /api/auth/send-code` — `src/app/api/auth/send-code/route.ts`
Email one-time-passcode request.
- **Request:** `{ email }`
- **Behavior:** generates a random 6-digit code, stores it in `email_codes` with a 10-minute
  expiry, and emails it via **AWS SES v2** (`SESv2Client` + `SendEmailCommand`).
- **Rate limit:** max 3 codes per email per 10 minutes → `429`.
- **Resilience:** SES failures are swallowed and the code is logged to console (sandbox dev).
  Sender defaults to `SES_SENDER_EMAIL` (fallback `Sandeep.Bhuiya@ridethenextwave.com`), region
  `SES_REGION` (default `us-east-1`).
- **Response:** `{ success: true }`.

#### `POST /api/auth/verify-code` — `src/app/api/auth/verify-code/route.ts`
Validate OTP and create-or-fetch the user.
- **Request:** `{ email, code }` (code must be 6 chars).
- **Behavior:** looks up the latest unused, unexpired `email_codes` row; marks it `used = true`;
  inserts a new `users` row if the email is new.
- **Response:** `{ userId, email, isNewUser }`; `401` on invalid/expired code.

#### `POST /api/auth/login` — `src/app/api/auth/login/route.ts`
Email + password login for pre-provisioned (invited) users.
- **Request:** `{ email, password }`.
- **Behavior:** `bcryptjs.compare` against `users.password_hash`.
- **Response:** `{ userId, email, isNewUser: false }`; `401` if no user, no password set, or bad
  password. Users without a `password_hash` are meant to fall through to the OTP flow.

#### `POST /api/auth/clean-slate` — `src/app/api/auth/clean-slate/route.ts`
Wipe all conversation data for a user (fresh start) while preserving the user record.
- **Request:** `{ userId }`.
- **Behavior:** deletes in FK-dependency order from `memory_layers` → `kwml_profiles` →
  `session_notes` → `messages` → `conversations`.
- **Response:** `{ success: true }`.

### 1.2 Conversation

#### `POST /api/conversation` (voice) — `src/app/api/conversation/route.ts`
The full voice turn — the primary endpoint.
- **Request:** `multipart/form-data` with `audio` (File), `userId`, optional `conversationId`.
- **Flow:** verify user → create a conversation (computing `session_number = COUNT(conversations)+1`)
  if none → `transcribeAudio` (Whisper) → load last 60 messages (fetched DESC, re-ordered ASC) →
  `processMessage` (the Marcus AI pipeline) → `synthesizeSpeech` (ElevenLabs).
- **Response:** raw `audio/mpeg` bytes with URI-encoded headers `X-User-Text`, `X-Marcus-Text`,
  `X-Emotion`, `X-Conversation-Id`.
- Also exposes **`GET /api/conversation?email=&name=`**: a dev helper that upserts a user by email
  and returns `{ id, email, name }`.

#### `POST /api/conversation/text` — `src/app/api/conversation/text/route.ts`
Text-only turn (same AI pipeline, no audio).
- **Request:** `{ userId, conversationId?, message }`.
- **Behavior:** same conversation-creation + 60-message history logic, then `processMessage`.
- **Response:** `{ marcusText, emotion, conversationId }`.

#### `GET /api/conversation/opening` — `src/app/api/conversation/opening/route.ts`
Generate Marcus's first (spoken-first) message for a session.
- **Query params:** `userId`, `skipTts`, `sessionType` (`continue|fresh`), `continueFrom` (a prior
  conversation id).
- **Ghost-session de-dupe:** a 30-second guard reuses a conversation created `<30s` ago with a
  matching `parent_session_id` + `metadata.sessionType`; if that conversation already has a
  `marcus` opening, it is returned directly. Otherwise a new conversation is inserted with
  `parent_session_id` + `metadata.sessionType`.
- **Generation:** builds context from `getMemoryContext`, `getSessionHistory`,
  `getStylePreferences`, the last session's `takeaways` / `pondering_topics`, and the last 6
  messages, then calls OpenAI `gpt-4o` (temp `0.75`, max `200` tokens) via
  `buildSystemPrompt(...) + openingInstruction`. The instruction branches on
  `fresh` / `continueFrom` / has-pondering / has-memory / first-ever.
- **Persistence:** stores the opening as a `marcus` message.
- **Response:** `audio/mpeg` (with `X-Marcus-Text`, `X-Conversation-Id`) unless `skipTts=true`, in
  which case `{ marcusText, conversationId }`.

#### `GET /api/conversations?userId=` — `src/app/api/conversations/route.ts`
Lists all conversations for a user that are ended OR have ≥1 user message, with subqueries for
`first_message`, `message_count`, and `user_message_count`. Response: `{ conversations: [...] }`.

#### `GET /api/conversations/[id]` — `src/app/api/conversations/[id]/route.ts`
Returns `{ conversation, messages }` — the full transcript (role, content, created_at,
emotion_detected, kwml_archetype) ordered ASC.

#### `POST /api/conversations/[id]` — same file — **End a session.**
- **Behavior:** loads the transcript, builds an emotion arc from `emotion_detected`, then calls
  OpenAI `gpt-4o-mini` (temp `0.2`, JSON mode) with one of two prompts (short-session vs normal) to
  produce `{ title, summary, takeaways[], pondering_topics[], pattern, action_plan{...}, check_in,
  mood, stoic_principle, topics[] }`.
- **Persistence:** updates `conversations` (`summary`, `ended_at=NOW()`, `session_ended=true`,
  `takeaways`, `pondering_topics`, merged `metadata`) and inserts a `session_notes` row.
- **Response:** the parsed JSON notes object.

#### `GET /api/conversations/recent?userId=` — `src/app/api/conversations/recent/route.ts`
Returns up to 20 ended sessions (with ≥1 user message) as continue-from candidates, with
title/summary/pondering previews and `sessionType`. No thread dedup (intentional — a user can
continue from any prior session). Response: `{ sessions: [...] }`.

### 1.3 Other

#### `POST /api/onboarding` / `GET /api/onboarding?userId=` — `src/app/api/onboarding/route.ts`
- **POST:** saves `{ userId, name, age, whatBroughtYou, answers }` into `users.profile_data`
  (JSONB), sets `users.name`, and `onboarding_complete = true`.
- **GET:** returns `{ onboardingComplete, profileData }`.

#### `GET /api/analytics?userId=` — `src/app/api/analytics/route.ts`
Aggregates dashboard stats via three parallel queries:
1. all conversations (+ metadata/takeaways/pondering + first_message + message_count),
2. weekly session counts for the last 8 weeks (`date_trunc('week', started_at)`),
3. the latest `session_notes` row.

Derives a `topics` frequency map from `metadata.topics` / title / first_message. Response:
`{ totalSessions, totalMessages, topics, conversations, weeklyUsage, lastSessionNotes }`.

#### `POST /api/test-conversation` — `src/app/api/test-conversation/route.ts`
Dev harness for the full pipeline (uses a 20-message history window). Returns rich diagnostics:
`{ userText, marcusText, emotion, kwmlArchetype, conversationId, audioSize, agentTimings, errors,
timings{ agentPipelineMs, ttsMs, totalMs, breakdown } }`.

---

## 2. Database

**Postgres (AWS RDS)** with the `vector` (pgvector) and `uuid-ossp` extensions.

### 2.1 Connection — `src/lib/db.ts`
A single `pg.Pool` configured from either `DATABASE_URL` (the Amplify SSR path) or discrete
`DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD`. Pool settings: `max: 20`,
`idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 10000`, `ssl: { rejectUnauthorized: false }`
(for AWS RDS). Exports:
- `query(text, params)` — logs any query slower than 1000ms,
- `getClient()` — a checked-out client for transactions,
- default export `pool`.

### 2.2 Base schema — `scripts/schema.sql`
Drops and recreates 8 tables:

| Table | Purpose / key columns |
|---|---|
| `users` | `id UUID PK`, `email UNIQUE`, `name`, `cognito_sub UNIQUE` (legacy, unused), `onboarding_complete BOOL`, `profile_data JSONB`, timestamps |
| `conversations` | `id UUID PK`, `user_id FK→users ON DELETE CASCADE`, `started_at`, `ended_at`, `summary`, `mood_start`/`mood_end`, `session_number`, `metadata JSONB` |
| `messages` | `id UUID PK`, `conversation_id FK→conversations CASCADE`, `role CHECK IN ('user','marcus','system')`, `content`, `audio_url` (unused), `created_at`, `emotion_detected`, `understanding_layer INT`, `kwml_archetype`, `metadata JSONB` |
| `memory_layers` | 7-layer memory: `user_id FK`, `layer_number 1–7`, `layer_name`, `key`, `value`, `confidence FLOAT`, `source_message_id FK→messages`, timestamps, `metadata` |
| `embeddings` | RAG store: `content`, `embedding vector(3072)`, `source_type CHECK IN ('book','question','conversation','reflection','doc','training_doc')`, `source_id`/`title`, `chunk_index`, `metadata` |
| `questions` | Question "IntelBase": `question_text` + KWML/assessment tags (`archetype`, `shadow`, `function`, `depth_level`, `arena`, `risk_polarity`, `emotion_context`, `perma_domain`, `trust_level`, `effectiveness_score`), `embedding vector(3072)` |
| `kwml_profiles` | Per-user King/Warrior/Magician/Lover scores + shadows, `dominant_archetype`, `shadow_active`, `conversation_id FK` |
| `reflections` | User/conversation-linked reflection text + `stoic_principle` |

B-tree indexes exist on FK/lookup columns. The **IVFFlat vector indexes** on
`embeddings.embedding` and `questions.embedding` (`vector_cosine_ops`, `lists=100`) are **commented
out** in `schema.sql` and are meant to be created after the data load.

### 2.3 Migrations & SQL scripts
- **`scripts/migrate-email-codes.sql`** — creates `email_codes` (`email`, `code`, `expires_at`,
  `used`, `created_at`) + indexes. Required by the OTP flow.
- **`scripts/migrate-session-flow.sql`** — adds `conversations.session_ended BOOL`,
  `conversations.takeaways JSONB`, `conversations.pondering_topics JSONB`; creates **`session_notes`**
  (`conversation_id`, `user_id`, `summary`, `takeaways`, `pondering_topics`, `emotion_arc`,
  `stoic_principle`, `title`, `mood`).
- **`scripts/rollback.sql`** — reverses the session-flow migration.
- **`scripts/clean-conversations.sql`** — deletes all conversation/message/memory/kwml/reflection
  data, preserving `users` + `embeddings` + `questions`.
- **`turn_logs`** — created at runtime by `ensureTurnLogsTable()` (not in `schema.sql`).

### 2.4 ⚠️ Schema drift (important)
Two columns are used by routes but are **NOT** defined in `schema.sql` or any migration — they must
be added via a manual `ALTER TABLE`:
- **`users.password_hash`** — used by `/api/auth/login` and created ad hoc in `scripts/create-users.ts`.
- **`conversations.parent_session_id`** — used by `/api/conversation/opening` and
  `/api/conversations/recent`.

`scripts/create-users.ts` seeds 4 named users with bcrypt(12) password hashes and
`onboarding_complete = true`.

---

## 3. Auth

There is **no NextAuth, no Cognito, and no server session/cookie/JWT layer** at runtime. Auth is
application-level and stateless:

- **Two entry paths:**
  1. **Email OTP** — `send-code` → SES email → `verify-code`.
  2. **Email + password** — `login`, bcrypt against `users.password_hash`.
  Both return a bare `userId` (the `users.id` UUID) to the client.
- The `userId` is then passed as a param/body field on **every** subsequent API call. There is no
  token verification or per-request authorization — any caller with a valid `userId` can act as
  that user. **This is the biggest security caveat in the backend.**
- `email_codes` provides OTP storage with expiry, single-use (`used` flag), and a 3-per-10-min rate
  limit. `users.cognito_sub` remains in the schema as a vestige but is unused.

---

## 4. Persistence & storage

- **Users:** `users` table; onboarding/profile in `profile_data` JSONB via `/api/onboarding`.
- **Conversations / messages:** created lazily on the first turn (`session_number` computed by
  counting). Messages are persisted **inside the AI pipeline**, not the route:
  `storeInBackground()` in `src/lib/agents/orchestrator-v2-composer.ts` (fire-and-forget) inserts
  the user message (with `emotion_detected`, `understanding_layer`, `kwml_archetype`) and the Marcus
  message, then triggers memory extraction and the KWML profile save. The V1 fallback
  (`src/lib/agents/orchestrator.ts`) does the equivalent.
- **Memory** — `src/lib/memory/memory-manager.ts` (see [AI.md](AI.md) §7 for the full model):
  - `extractMemories()` — `gpt-4o-mini` (JSON mode) pulls memory-worthy facts + regex-detects style
    preferences (e.g. "stop asking questions" → `style_*` keys).
  - `storeMemory()` — upserts with confidence reinforcement (+0.1, cap 1.0).
  - `getMemoryContext()` — renders layered context for the prompt.
  - `searchPastMessages()` — in-app cosine similarity over `text-embedding-3-small` (256-dim)
    embeddings of the last 100 user messages.
  - `getSessionHistory()` — narrates prior ended sessions.
  - `getStylePreferences()` — reads `style_*` keys.
- **Session summaries:** written to `conversations` + `session_notes` on session end.
- **S3:** **not used at runtime** despite the `@aws-sdk/client-s3` dependency — S3 is only an
  ingestion-time input (`scripts/ingest-books.ts` pulls source books). **SES v2**
  (`@aws-sdk/client-sesv2`) is the only AWS SDK actually imported in `src/` — for OTP email in
  `send-code`. `@aws-sdk/client-secrets-manager` is a dependency but is not imported in `src/`.
- **Voice:** `src/lib/voice/stt.ts` transcribes via OpenAI Whisper (`whisper-1`);
  `src/lib/voice/tts.ts` synthesizes via ElevenLabs REST (`eleven_multilingual_v2`,
  `ELEVENLABS_VOICE_ID` / `ELEVENLABS_API_KEY`). Audio is streamed back in the HTTP response body; it
  is **not stored** (the `messages.audio_url` column is unused).

---

## 5. Observability — `src/lib/observability/turn-logger.ts`

- `ensureTurnLogsTable()` lazily creates `turn_logs` (SERIAL PK), capturing the full turn trace:
  utterance / final_response, sentinel outputs (`crisis_level`/`type`, `boundary_violations[]`),
  the assessment ring (`phase` + confidence, `archetype`, `shadow`, `trust_cognitive`/`affective`,
  `silence_type`, `arena_primary`, `arena_weights JSONB`), `wisdom_voices[]`,
  `whisperers_invoked[]`, `frameworks_applied[]`, craft form/pacing, `agent_timings JSONB`,
  `errors JSONB`, cultural `register`/`faith_context`, and `pathway_candidates JSONB`.
- `logTurn(env)` inserts from the `StateEnvelope` (fire-and-forget, called from the composer).
- Read helpers: `getCrisisEvents(userId)` and `getArchetypePath(userId, limit)` power a clinical
  dashboard. Indexes on user, conversation, and a partial index on non-`none` crisis.
- Telemetry never breaks a turn. `db.ts` additionally warns on slow queries.

---

## 6. End-to-end server flow (a text turn)

1. `POST /api/conversation/text` verifies the user, creates the conversation if needed, and loads
   the last 60 messages (re-ordered ASC) as `{ role, content }` history.
2. Calls `processMessage()` (`src/lib/agent/marcus.ts`), which runs the **V2 orchestrator**
   (`processWithAgents` in `src/lib/agents/orchestrator-v2.ts`) and **falls back to V1**
   (`src/lib/agents/orchestrator.ts`) on error.
3. V2 builds a `StateEnvelope` and runs its 6 tiers (Sentinels → Assessment → Wisdom/PERMA/
   Whisperers → Composer). Full detail in [AI.md](AI.md).
4. `storeInBackground()` persists the user + Marcus messages, runs `extractMemories` and
   `saveKWMLProfile`; `logTurn` writes the trace to `turn_logs`.
5. The route returns `{ marcusText, emotion, conversationId }` (the voice route instead returns
   ElevenLabs `audio/mpeg` with metadata headers).

---

## 7. Backend caveats (summary)

1. **Schema drift** — `users.password_hash` and `conversations.parent_session_id` are referenced in
   code but absent from schema/migrations (apply via manual `ALTER TABLE`).
2. **No transport-level auth** — `userId` is trusted from the client on every request.
3. **Unused dependencies** — `@aws-sdk/client-s3` and `@aws-sdk/client-secrets-manager` are not
   imported in `src/`.
4. **Unused columns** — `messages.audio_url` and `users.cognito_sub` exist but are unused.
5. **`ssl.rejectUnauthorized: false`** on the DB pool — fine for a prototype; revisit for prod.
