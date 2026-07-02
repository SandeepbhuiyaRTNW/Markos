# Marcus / mrkos.ai — Project Overview & Current State

> **Marcus** (internal name **Markos**, product name **mrkos.ai**) is a voice-first AI
> conversational companion that embodies **Marcus Aurelius**. It is built for men navigating
> work, relationships, identity, loss, and purpose, and meets them with Stoic wisdom through a
> sophisticated multi-agent conversation engine.

---

## 1. What this is

- A **Next.js 16 (App Router) + React 19 + TypeScript** application.
- The frontend is a single voice-first SPA; the "backend" is a set of Next.js API route
  handlers that run a **6-tier multi-agent AI orchestrator** on top of OpenAI + LangChain, with
  **RAG** over an ingested wisdom/question knowledge base stored in **PostgreSQL + pgvector**.
- Voice in/out: **OpenAI Whisper** for speech-to-text, **ElevenLabs** for text-to-speech.
- Hosted on **AWS Amplify** (primary), backed by **AWS RDS Postgres**, **S3** (knowledge
  ingestion), and **SES** (email one-time-passcodes).

This repository is documented across four companion files:

| Doc | Scope |
|---|---|
| [OVERVIEW.md](OVERVIEW.md) | This file — what the product is, the stack, and current maturity |
| [BACKEND.md](BACKEND.md) | API routes, database schema, auth, persistence, observability |
| [FRONTEND.md](FRONTEND.md) | App shell, components, voice UX, state, styling, user flows |
| [AI.md](AI.md) | The multi-agent orchestrator, whisperers, sentinels, assessment, RAG, voice AI |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Build config, hosting, cloud services, env vars, scripts, testing |

---

## 2. Product concept

Marcus is not a chatbot and not a therapist. He is a **Stoic companion** modelled on Marcus
Aurelius who listens, reflects, and asks disciplined questions. The system is engineered around a
few strong opinions:

- **Voice-first.** The primary interaction is speaking to an orb and hearing a spoken reply. A
  parallel **text mode** exists for accessibility and testing.
- **Depth over chat.** A large part of the engineering effort goes into *presence* and
  *conversation depth* — meeting a heavy disclosure deeply rather than deflecting with small talk.
- **Safety-critical.** A dedicated **Sentinel** layer intercepts crisis language (self-harm,
  suicidal ideation) and emits verified crisis resources (988 / 741741) before any other
  processing runs.
- **Domain intelligence via "whisperers".** 14 domain experts (divorce, grief, addiction,
  fatherhood, money, veteran, faith crisis, etc.) contribute specialised questions, frameworks,
  and "landmines to avoid" when a conversation enters their arena.
- **Persistent memory.** A 7-layer memory model remembers identity, relationships, goals,
  challenges, decision patterns, and wins across sessions, so continuity is real.

---

## 3. Technology stack at a glance

| Layer | Technology |
|---|---|
| Framework | Next.js `16.1.6` (App Router, `output: standalone`, React Compiler on) |
| UI | React `19.2.3`, TypeScript `5`, Tailwind CSS v4, shadcn/ui (new-york) + Radix, lucide icons |
| AI / LLM | OpenAI (`gpt-4o`, `gpt-4o-mini`, `whisper-1`, `text-embedding-3-*`), LangChain (`@langchain/*`) |
| Voice | OpenAI Whisper (STT), ElevenLabs (`eleven_multilingual_v2`, TTS) |
| Data | PostgreSQL (AWS RDS) + `pgvector`, accessed via `pg` connection pool |
| Auth | Custom email-OTP (AWS SES) + bcrypt password login. **No** NextAuth/Cognito at runtime |
| Cloud | AWS `us-east-1` — Amplify (hosting), RDS, S3, SES |
| Tooling | `tsx` for scripts, ESLint 9 (flat config), `legacy-peer-deps=true` |

---

## 4. Repository map

```
Marcus work/
├── src/
│   ├── app/
│   │   ├── api/                     # 13 route handlers (the backend)
│   │   │   ├── auth/                # send-code, verify-code, login, clean-slate
│   │   │   ├── conversation/        # voice turn, text turn, opening line
│   │   │   ├── conversations/       # list, [id] detail/end, recent
│   │   │   ├── onboarding/          # profile + intake answers
│   │   │   ├── analytics/           # dashboard aggregation
│   │   │   └── test-conversation/   # dev pipeline harness
│   │   ├── layout.tsx               # root layout (Inter font, metadata)
│   │   ├── page.tsx                 # the entire SPA (~1100 lines, 'use client')
│   │   └── globals.css              # Tailwind v4 CSS-first theme
│   ├── components/                  # VoiceOrb, ConversationView, OnboardingFlow, Sidebar,
│   │   │                            # AnalyticsDashboard, VoiceButton*, Waveform*  (* legacy)
│   │   └── ui/                      # shadcn/ui primitives
│   └── lib/
│       ├── agent/                   # marcus.ts (entry), system-prompt.ts
│       ├── agents/                  # orchestrator, orchestrator-v2(+composer), state-envelope,
│       │                            # conversational-agent, rag-agent, tools, mcp-context
│       ├── whisperers/              # 14 domain experts + base + index
│       ├── sentinels/               # crisis, boundary, ai-honesty, frame-refusal, cultural, ...
│       ├── assessment/              # arena-classifier, perma-snapshot, phase-mapper,
│       │                            # silence-typer, trust-gauge
│       ├── memory/                  # memory-manager.ts (7-layer memory)
│       ├── rag/                     # retriever.ts
│       ├── craft/                   # craft-layer.ts (response shaping)
│       ├── kwml/                    # detector.ts (King/Warrior/Magician/Lover archetypes)
│       ├── understanding/           # stack.ts (listener stack)
│       ├── wisdom/                  # council.ts (wisdom voices)
│       ├── observability/           # turn-logger.ts
│       ├── voice/                   # stt.ts (Whisper), tts.ts (ElevenLabs)
│       └── db.ts                    # pg Pool
├── scripts/                         # ingestion, migrations, seed users, tests, QA
├── Additional docs/Docs/            # source knowledge (docx/xlsx) for ingestion
├── amplify.yml                      # AWS Amplify build spec (primary hosting)
├── next.config.ts                   # standalone output + env passthrough
└── docs/                            # ← this documentation set
```

---

## 5. High-level request flow

A single voice turn:

```
Client (VoiceOrb, MediaRecorder → webm)
   │  POST /api/conversation  (multipart: audio, userId, conversationId?)
   ▼
API route  → verify user → create/resume conversation → load last 60 messages
   │
   ├─ STT: transcribeAudio()  (OpenAI whisper-1)
   │
   ├─ processMessage()  →  V2 orchestrator (6 tiers)  ── fallback ──▶ V1 orchestrator
   │       Tier 1  Sentinels   (crisis short-circuit, AI-honesty, frame-refusal) + context load
   │       Tier 2  Assessment  (arena, silence, trust, phase, pathway router)
   │       Tier 3/4 Wisdom + PERMA + whisperer routing (≤3 arena whisperers)
   │       Tier 0/5 Composer   (RAG retrieve + re-rank, escalation, craft, LLM compose, boundary)
   │
   ├─ TTS: synthesizeSpeech()  (ElevenLabs)
   │
   └─ persist messages + memory + KWML + turn_logs  (fire-and-forget)
   ▼
Response: audio/mpeg  +  headers X-User-Text, X-Marcus-Text, X-Emotion, X-Conversation-Id
```

See [AI.md](AI.md) for the full tier-by-tier breakdown and [BACKEND.md](BACKEND.md) for the
route-level detail.

---

## 6. Current state & maturity (as of July 2026)

**Overall: a feature-rich, actively-developed pre-1.0 prototype** (`version 0.1.0`). It is
demo-ready — a full 40-minute technical talk deck exists (`MINIBAR-SPEAKER-GUIDE.md`) — but
carries the hallmarks of a fast-moving small build.

**Built & stable:**
- Auth: email-OTP (SES) + bcrypt password login for a hardcoded invited-user list.
- Session lifecycle: new-topic / continue-session, opening lines, on-demand session summaries and
  "session notes" (takeaways, pondering topics, patterns, action plan, check-in, Stoic principle).
- Persistent 7-layer memory and cross-session recall.
- RAG over ingested wisdom docs + a versioned question "IntelBase" (v9 → v12).
- Analytics dashboard (sessions, exchanges, weekly usage, topics).
- Crisis / safety intercepts — verified emitting 988 / 741741 in QA.
- The full 6-tier V2 multi-agent orchestrator with 14 whisperers and PERMA snapshotting.

**Actively in progress (top of git history):**
- **Conversation depth** — wiring the escalation engine into V2, fixing trajectory case
  mismatches and history ordering (`4e5c7fd`), decoupling presence-depth from session gating
  (`b592382`), injecting phase constraints / priority hierarchy / lower temperature (`ac04f14`).
- **Whisperer intelligence** — wiring whisperer landmines + context notes into the Composer
  (`1d19b47`) and integrating the divorce/grief training document (`8421885`).

The V2 orchestrator is the current center of gravity; the V1 orchestrator remains as a
transitional fallback.

**Testing:** ~40 unit + 7 E2E checks plus scripted QA batteries (no formal Jest/Vitest runner).
The most recent captured run (`qa-test-results.txt`, 2026-04-18) passed all 9 QA prompts,
including the safety-critical passive-suicidal-ideation case.

---

## 7. Known gaps & things to reconcile

These are surfaced so they are not lost; they are documented in more depth in the respective docs.

1. **Schema drift.** `users.password_hash` and `conversations.parent_session_id` are used by code
   but are **not** in `schema.sql` or any migration — they must be added via manual `ALTER TABLE`.
2. **Auth is unauthenticated at the transport level.** `userId` is trusted from the client on
   every request; there is no session token / JWT / cookie verification.
3. **Dual hosting configs.** Both `amplify.yml` (committed, primary) and a `.vercel/` link exist.
   Amplify is production; the Vercel link appears experimental. Pick one and document it.
4. **Provisioned-but-unused services.** `@aws-sdk/client-s3` and `@aws-sdk/client-secrets-manager`
   are dependencies but S3 is only used at ingestion time and Secrets Manager is unused. Cognito
   is provisioned (env + `cognito_sub` column) but **not wired** into the live auth path.
5. **Secrets handling.** Amplify's `preBuild` echoes 14 secrets into `.env.production`; DB uses
   `ssl.rejectUnauthorized: false`. Acceptable for a prototype; revisit before production.
6. **Doc drift.** `MINIBAR-SPEAKER-GUIDE.md` says "Next.js 15 / 14 whisperers"; actual is Next.js
   `16.1.6` and 14 domain whisperers (+ base + index = 16 files).

---

*Generated as an end-to-end codebase documentation pass. See the companion docs for detail.*
