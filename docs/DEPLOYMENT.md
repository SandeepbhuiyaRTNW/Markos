# Marcus / mrkos.ai — Deployment, Infrastructure & Operations

App: `marcus-app` (a.k.a. "Marcus" / "Markos" / mrkos.ai). Root: `/Users/sandeepbhuiya/Marcus work`.
Branch: `main`. Framework: **Next.js 16 (App Router, `output: standalone`) + TypeScript + React 19**.

> Related: [OVERVIEW.md](OVERVIEW.md) · [BACKEND.md](BACKEND.md) · [AI.md](AI.md)

---

## 1. Build & framework configuration

### `package.json`
- `name: marcus-app`, `version: 0.1.0`, `private: true`. **No** `engines` / `packageManager` field.
- **Scripts:** `dev → next dev`, `build → next build`, `start → next start`, `lint → eslint`.
  **No `test` script** — tests run ad hoc via `tsx` / shell / python (see §5, §7).

**Key dependencies (exact ranges):**

| Package | Version | Package | Version |
|---|---|---|---|
| `next` | `16.1.6` | `react` / `react-dom` | `19.2.3` |
| `@aws-sdk/client-s3` | `^3.994.0` | `@aws-sdk/client-secrets-manager` | `^3.994.0` |
| `@aws-sdk/client-sesv2` | `^3.1020.0` | `amazon-cognito-identity-js` | `^6.3.16` |
| `@langchain/community` | `^1.1.17` | `@langchain/core` | `^1.1.27` |
| `@langchain/openai` | `^1.2.9` | `langchain` | `^1.2.25` |
| `openai` | `^6.22.0` | `pg` / `@types/pg` | `^8.18.0` / `^8.16.0` |
| `next-auth` | `^4.24.13` | `bcryptjs` | `^3.0.3` |
| `mammoth` (docx) | `^1.12.0` | `xlsx` | `0.18.5` |
| `uuid` | `^13.0.0` | `radix-ui` | `^1.4.3` |
| `lucide-react` | `^0.575.0` | `class-variance-authority` | `^0.7.1` |
| `clsx` | `^2.1.1` | `tailwind-merge` | `^3.5.0` |
| `tw-animate-css` | `^1.4.0` | `shadcn` | `^3.8.5` |

**devDependencies:** `typescript ^5`, `tsx ^4.21.0`, `eslint ^9`, `eslint-config-next 16.1.6`,
`tailwindcss ^4`, `@tailwindcss/postcss ^4`, `babel-plugin-react-compiler 1.0.0` (pinned),
`@types/node ^20`, `@types/react ^19`, `@types/react-dom ^19`, `@types/bcryptjs ^2.4.6`.

> The app is effectively a full backend (LangChain, OpenAI, pgvector via `pg`, AWS SDK v3) running
> inside a Next.js frontend package.

### `next.config.ts`
- `output: "standalone"` — self-contained server bundle (required for Amplify's Lambda-style
  runtime).
- `reactCompiler: true` — React Compiler auto-memoization (paired with pinned
  `babel-plugin-react-compiler 1.0.0`).
- `serverExternalPackages: ["pg", "pg-pool", "pg-native"]` — keeps native Postgres bindings out of
  the bundle.
- **`env` passthrough block** re-exports 14 vars into the SSR runtime (standalone bakes env at build
  time): `DATABASE_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `OPENAI_API_KEY`,
  `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `S3_BUCKET`, `NEXTAUTH_SECRET`, `SES_ACCESS_KEY_ID`,
  `SES_SECRET_ACCESS_KEY`, `SES_SENDER_EMAIL`, `SES_REGION`.

### Other config
- **`tsconfig.json`** — `target ES2017`, `module esnext`, `moduleResolution bundler`, `strict`,
  `noEmit`, `jsx react-jsx`, `incremental`, path alias `@/*` → `./src/*`, Next plugin registered.
- **`eslint.config.mjs`** — flat config composing `eslint-config-next/core-web-vitals` +
  `.../typescript`, with `globalIgnores` for `.next/**`, `out/**`, `build/**`, `next-env.d.ts`.
- **`postcss.config.mjs`** — single plugin `@tailwindcss/postcss` (Tailwind v4, CSS-first, no
  `tailwind.config`).
- **`.npmrc`** — `legacy-peer-deps=true` — required to install given React 19 / Next 16 / bleeding-edge
  LangChain peer-dependency conflicts. Also governs Amplify's `npm ci`.

---

## 2. Hosting — dual config (AWS Amplify is primary)

Two hosting configs coexist:

### AWS Amplify — `amplify.yml` (PRIMARY)
```yaml
version: 1
frontend:
  phases:
    preBuild:   # npm ci  +  echo each of 14 env vars into .env.production
    build:      # npm run build
  artifacts:
    baseDirectory: .next
    files: ['**/*']
  cache:
    paths: [ node_modules/**/*, .next/cache/**/* ]
```
- **preBuild:** runs `npm ci`, then writes 14 env vars into `.env.production` via
  `echo "VAR=$VAR" >> .env.production` (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD,
  DATABASE_URL, OPENAI_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, S3_BUCKET, NEXTAUTH_SECRET,
  SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_SENDER_EMAIL, SES_REGION). This injects Amplify
  console env vars into the standalone build.
- **build:** `npm run build`; **artifacts baseDirectory:** `.next`; **cache:** `node_modules` +
  `.next/cache`.

### Vercel — `.vercel/` (secondary / experimental; gitignored)
- `.vercel/project.json`: `projectName: "marcus-app"`, `projectId: prj_tp8Ek3Joo5zQBaaljhYU8eCA8hbn`,
  `orgId: team_8upWTVrdOb1UqiCYiwzmPGu1`. `.vercel` is in `.gitignore` (not committed).

**Which is primary? AWS Amplify.** Evidence: the committed `amplify.yml`; the `next.config.ts`
comment "Pass env vars through to SSR runtime (needed for Amplify)"; the `db.ts` comment "Amplify SSR
may only have DATABASE_URL available at runtime"; commit `5ffaa76 trigger: fresh Amplify deployment`;
and `MINIBAR-SPEAKER-GUIDE.md` listing **Hosting: AWS Amplify**. Vercel appears to have been trialed
(commit `100d539 fix: lazy-init all OpenAI clients for Vercel build compatibility`) but the link is
untracked/local. **Treat Amplify as production; Vercel as experimental.**

**The secrets flow:** Amplify console env → echoed into `.env.production` at preBuild → baked into
the standalone build via the `next.config.ts` `env` block.

---

## 3. Cloud services (AWS `us-east-1`)

All AWS SDK clients default to `us-east-1` in code.

- **RDS PostgreSQL** (`mrkos-db`) with **pgvector**. Connection via `src/lib/db.ts` — a `pg` `Pool`
  (max 20, 30 s idle, 10 s connect timeout, `ssl.rejectUnauthorized: false`). Prefers
  `DATABASE_URL`; falls back to discrete `DB_*` vars. Stores memory, RAG embeddings, questions,
  sessions, turn logs.
- **S3** (`mrkos-knowledge-base` bucket, via `S3_BUCKET`): used **only** by `scripts/ingest-books.ts`
  (`GetObjectCommand` to pull source books for embedding). Not a request-path dependency.
- **Cognito user pool** (`amazon-cognito-identity-js` dep; `users.cognito_sub` column;
  `COGNITO_*` in `.env.local`). **Provisioned/planned but not wired** into the current auth path,
  which uses custom email-OTP + bcrypt (see [BACKEND.md](BACKEND.md) §3).
- **SES v2** email (`@aws-sdk/client-sesv2`) in `src/app/api/auth/send-code/route.ts` — sends 6-digit
  OTP codes. Uses `SES_REGION` (default `us-east-1`) and *optional* explicit
  `SES_ACCESS_KEY_ID`/`SES_SECRET_ACCESS_KEY` (falls back to the default AWS credential chain).
- **Secrets Manager** (`@aws-sdk/client-secrets-manager`) — declared dependency, **no active usage**.
- **External APIs:** OpenAI (embeddings + GPT-4o/4o-mini + Whisper) and **ElevenLabs** (TTS).

---

## 4. Environment variables (names only — no values)

Sources: `next.config.ts` env block, `amplify.yml`, `grep process.env` across `src/` + `scripts/`,
`.env.local` (keys only).

| Group | Variables |
|---|---|
| Database (RDS Postgres) | `DATABASE_URL`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| OpenAI | `OPENAI_API_KEY` |
| ElevenLabs (voice) | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` |
| AWS S3 + general | `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`*, `AWS_SECRET_ACCESS_KEY`* |
| AWS SES (email OTP) | `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `SES_SENDER_EMAIL`, `SES_REGION` |
| AWS Cognito | `COGNITO_USER_POOL_ID`*, `COGNITO_CLIENT_ID`*, `COGNITO_DOMAIN`* (local only; not used at runtime) |
| NextAuth | `NEXTAUTH_SECRET`, `NEXTAUTH_URL`* |
| Testing only | `TEST_URL` |

`*` = present in `.env.local` and/or the SDK default chain but **not** in the `amplify.yml` /
`next.config.ts` 14-var passthrough set. Note `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
`COGNITO_*` / `NEXTAUTH_URL` are configured locally but **not** in the Amplify `.env.production`
injection list — a potential prod/dev drift to reconcile.

> ⚠️ `.env.local` and `.env*` are gitignored and contain **live secrets** (DB password, AWS keys,
> OpenAI + ElevenLabs keys). These must **never** be committed. This doc lists names only.

---

## 5. Scripts & tooling (`scripts/`)

**Run pattern** (from script headers):
`set -a && source .env.local && set +a && npx tsx scripts/<name>.ts` (TS scripts via **`tsx`**). SQL
via `psql $DATABASE_URL -f scripts/<name>.sql`.

**Knowledge / RAG ingestion (`tsx`):** `ingest-books.ts` (S3 books), `ingest-local-books.ts`,
`ingest-docs.ts` (docx/xlsx), `ingest-questions-v2.ts` / `ingest-questions-v12.ts` /
`load-questions.ts` (question IntelBase v2 → v12), `ingest-divorce-grief-expansion.ts`,
`audit-chunks.ts` (chunk QA, `--fix` deletes). Detail in [AI.md](AI.md) §6.1.

**User / auth admin (`tsx`):** `create-users.ts` — bcrypt-hashes and upserts a hardcoded invited-user
list (4 seed accounts).

**Diagnostics (`tsx`, untracked):** `depth-test.ts` (multi-turn depth-escalation probe through the
live V2 pipeline); `check-divorce-grief-data.ts` (read-only DB check for training data).

**SQL (`psql`):** `schema.sql` (full init — 8 tables + extensions + indexes), `migrate-session-flow.sql`,
`migrate-email-codes.sql`, `rollback.sql`, `clean-conversations.sql`. Detail in [BACKEND.md](BACKEND.md)
§2.

---

## 6. Database bring-up (fresh environment)

1. Provision RDS Postgres with the `vector` (pgvector) + `uuid-ossp` extensions.
2. `psql $DATABASE_URL -f scripts/schema.sql` — creates the 8 base tables.
3. `psql $DATABASE_URL -f scripts/migrate-email-codes.sql` — the OTP table.
4. `psql $DATABASE_URL -f scripts/migrate-session-flow.sql` — session lifecycle columns +
   `session_notes`.
5. **Apply schema-drift columns manually** (not in any migration):
   `ALTER TABLE users ADD COLUMN password_hash TEXT;`
   `ALTER TABLE conversations ADD COLUMN parent_session_id UUID;`
6. Create the **IVFFlat vector indexes** (commented out in `schema.sql`) after loading data.
7. Ingest the knowledge base (`ingest-*.ts`) and seed users (`create-users.ts`).

---

## 7. Testing infrastructure

No formal test runner (Jest/Vitest) and no `npm test` — a hand-rolled suite run manually:
- **`scripts/test-unit.ts`** (~16 KB) — unit tests (per commit `9788849`: "40 unit + 7 E2E, all
  passing").
- **`scripts/test-v2-pipeline.ts`** (~16 KB) — integration tests of the V2 orchestrator.
- **`scripts/test-e2e-users.ts`** / **`scripts/test-e2e.sh`** — end-to-end flows (shell version
  bootstraps a `USER_ID`, uses `TEST_URL`).
- **`scripts/test-qa-prompts.sh`**, **`test-new-features.sh`**, **`test-scenarios.sh`** — scripted QA
  prompt batteries against a running server.
- **`scripts/run-qa-test.py`** (~8 KB) — Python QA harness running the "8 Priority Prompts from Ben
  Report" against the live conversation API with automatic checks.
- **`qa-test-results.txt`** — captured output dated **2026-04-18**: 9 QA prompts (opening, first
  disclosure, AI-honesty, therapy projection, framework exposure, **passive suicidal ideation
  (safety-critical — verified emits 988 / 741741)**, silence-breaking, forced-friend refusal,
  alexithymia) — **all 9 PASS**, checked for banned phrases, therapy-speak, and role/safety
  compliance.

**Run mechanics:** TS tests via `npx tsx`; shell tests via `bash`; python via `python
run-qa-test.py`; all depend on `.env.local` being sourced and (for E2E/QA) a running server at
`TEST_URL`.

---

## 8. Operational caveats (deployment)

1. **Decide the host.** Amplify is primary; the stray `.vercel/` link should be removed or
   formalized.
2. **Secrets baked into the build.** `preBuild` echoes 14 secrets into `.env.production`; the DB pool
   uses `ssl.rejectUnauthorized: false`. Fine for a prototype; harden before production (consider
   AWS Secrets Manager — the SDK is already a dependency).
3. **pgvector prerequisites.** The DB needs pgvector, `schema.sql`, the two migrations, the two
   manual schema-drift columns, and the post-load IVFFlat indexes.
4. **Cognito / Secrets Manager are provisioned/declared but unused** — current auth is SES OTP +
   bcrypt.
5. **Env drift.** The Amplify 14-var set omits `AWS_ACCESS_KEY_ID` / `COGNITO_*` / `NEXTAUTH_URL`
   present locally — reconcile before relying on them in prod.
6. **`legacy-peer-deps=true` is mandatory** for installs (and Amplify's `npm ci`).
