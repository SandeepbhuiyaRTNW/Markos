# Marcus / mrkos.ai — AI Architecture Documentation

This is the heart of the system: a **6-tier multi-agent conversation engine** with a persona core,
14 domain "whisperers", a defense-in-depth safety layer, a semantic escalation engine, and RAG over
a pgvector knowledge base. Persona = Marcus Aurelius (spelled "Marcus" and "Markos" interchangeably
in code). **No Anthropic/Claude model is used anywhere** — the stack is OpenAI (raw SDK + a thin
LangChain wrapper) + ElevenLabs/Whisper for voice.

> Related: [OVERVIEW.md](OVERVIEW.md) · [BACKEND.md](BACKEND.md) · [FRONTEND.md](FRONTEND.md)

---

## 0. Models & providers at a glance

| Purpose | Model | Settings | Where |
|---|---|---|---|
| Main response Composer (V2) | `gpt-4o` (via `ChatOpenAI`) | `temperature 0.75`, `maxTokens 350` | `orchestrator-v2-composer.ts` |
| V1 conversational agent | `gpt-4o` (via `ChatOpenAI`) | `temp 0.8`, `maxTokens 350`, `presencePenalty 0.6`, `frequencyPenalty 0.5` | `conversational-agent.ts` |
| Understanding, KWML, arena, silence, memory-extract, RAG re-rank | `gpt-4o-mini` | temps 0.1–0.3, `response_format: json_object` | various |
| Opening line | `gpt-4o` | `temp 0.75`, `max 200` | `api/conversation/opening` |
| Session notes / end-session summary | `gpt-4o-mini` | `temp 0.2`, JSON mode | `api/conversations/[id]` |
| Wisdom embeddings (books/questions) | `text-embedding-3-large` | **3072 dims** | `rag/retriever.ts` |
| Intent / hopelessness / trajectory / memory-search embeddings | `text-embedding-3-small` | **256 dims** | `conversation-state.ts`, `memory-manager.ts` |
| STT (voice in) | OpenAI **`whisper-1`** | `language: 'en'` | `voice/stt.ts` |
| TTS (voice out) | **ElevenLabs** `eleven_multilingual_v2` | stability 0.65, similarity 0.78, style 0.15 | `voice/tts.ts` |

**LangChain usage is deliberately limited:** `@langchain/openai` (`ChatOpenAI`) for the two
Composers; `@langchain/langgraph` (`StateGraph`) only in the V1 orchestrator; `langchain` `tool()`
wrappers in `tools.ts` (defined but the live pipeline bypasses them — "No LangChain ReactAgent
overhead"). Every other LLM call uses the raw `openai` SDK.

---

## 1. Orchestration pipeline

### 1.1 `src/lib/agent/marcus.ts` — the router
`processMessage()` calls **V2** (`orchestrator-v2.ts`) and, on any throw, falls back to **V1**
(`orchestrator.ts`). Both expose the same `AgentResponse { response, emotion, kwmlArchetype,
agentTimings, errors }`.

### 1.2 V1 — `orchestrator.ts` (legacy, LangGraph)
A `StateGraph` (`@langchain/langgraph`) over an `MCPContext` bus (`mcp-context.ts`). Flow:
`START → enrich → respond → END`, with `store` fire-and-forget. `enrichNode` fetches
memory/KWML/session-count/history (fast DB, ~75 ms) then runs Understanding + RAG + KWML LLM agents
in parallel. `respondNode` calls `runConversationalAgent` (`gpt-4o`). "MCP" here is an **in-process**
Model-Context-Protocol-style shared bus (not MCP-over-HTTP), tuned for low-latency voice.

### 1.3 V2 — `orchestrator-v2.ts` + `orchestrator-v2-composer.ts` (active)
A hand-coded **6-tier turn flow** that replaces `MCPContext` with the **State Envelope** bus.
`processWithAgents()` runs:

**Tier 1 — Sentinels (parallel, every turn, BEFORE any generation).** Short-circuits that return
canned text and hard-block the LLM, tested in order:
1. `detectCrisisType()` — if acute (non-`passive_crisis`), sets `crisis.level='acute'` and returns a
   canned `getCrisisResponse()` (vocative-filtered).
2. `isPostCrisisRetreat()` → canned `POST_CRISIS_RETREAT_RESPONSE`.
3. `detectAIIdentityQuestion()` → forced `getAIHonestyResponse()`.
4. `detectFrameCollapse()` → `getFrameRefusalResponse()`.
5. Non-blocking context load: Memory (DB), Listener-Stack (understanding LLM), KWML (LLM), Cultural,
   and the passive-crisis flag (`level='elevated'`).

**Tier 2 — Assessment Ring (parallel):** `classifyArena`, `classifySilence`, `computeTrust`,
`mapPhase`, then `runPathwayRouter`.

**Tiers 3 + 4:** `selectWisdomVoices`, `computePERMASnapshot`, and Whisperer routing — arenas with
weight ≥ `WHISPERER_ACTIVATION_THRESHOLD` (0.15), top-3, run in parallel via `WHISPERER_REGISTRY`.

**Composer pipeline** (`runComposerAndFinish` → `orchestrator-v2-composer.ts`):
- **Pre-Composer parallel:** `retrieveWisdom(utterance, 5)`, `retrieveQuestion(...)`, and
  `analyzeConversation()` (the escalation engine).
- `determineCraftDirectives()` (Tier 5).
- Builds `fullSystem` = `buildSystemPrompt(...)` + envelope context summary + wisdom-council prompt +
  **phase constraints** (`getPhaseConstraints`, with `effectiveMaxDepth = max(phase.max_depth,
  presentedDepth)` — "meet him where he is") + craft addendum + a **priority hierarchy**
  (`buildPriorityHierarchy`, placed LAST for maximum attention) + escalation overrides.
- Calls **`gpt-4o`** (temp 0.75).
- **Post-processing chain (each may trigger ONE regeneration):** `enforceSocraticDiscipline` →
  `applyDeepListener` → **Boundary sentinel** (`checkBoundary`; regen on violation) → **trajectory
  dedup** (`computeTrajectoryDrift > 0.85` → regen) → `detectFantasyIdentity` (regen) →
  `detectVocabSubstitutions` (regen) → `detectForbiddenPhrases` (regen) → `enforceVocativePrinciple`
  (always last) → crisis-resource append for `elevated`.
- Store + `logTurn` observability, both fire-and-forget.

### 1.4 State Envelope — `state-envelope.ts`, `state-envelope-utils.ts`
The typed structure that moves through every turn (per the internal "§10 Markos Multi-Agent
Architecture v1" spec). `createStateEnvelope()` seeds defaults; `trackEnvelopeAgent()` records
per-agent timings; `listenerStackFromAnalysis()` adapts the understanding output;
`buildEnvelopeContextSummary()` renders envelope intelligence into the system prompt.

Structure: `sentinels{ listener_stack, crisis, boundary, pathway_router, memory, cultural,
ai_honesty, frame_refusal }`, `assessment{ phase, archetype, trust, silence_type, arena, perma }`,
`wisdom_council`, `domain_whisperers`, `craft_directives`, outputs, and metadata. Key enums:
`Phase = 'unsilenced' | 'unleashed' | 'brothered'`; `CrisisType` (6 values); `SilenceType`
(5 values).

### 1.5 `conversation-state.ts` — the escalation engine (semantic, embeddings-based)
`analyzeConversation()` returns a `ConversationState`. It uses `text-embedding-3-small` (256-dim)
anchor comparisons for:
- `classifyIntent` — 6 intents: exploration / seeking_direction / venting / hopelessness /
  resistance / oscillation.
- recency-weighted **hopelessness scoring** — anchors drawn from Brownhill "Big Build" + Joiner IPT
  markers → levels 0–4.
- `computeTrajectoryDrift` — loop/repetition detection.
- emotional direction.

It emits hard-constraint templates that become the highest-priority "CONVERSATION STATE — OVERRIDE"
block in the Composer prompt: `HOPELESSNESS_TEMPLATES` (Level 3 = Persistent Crisis Protocol with the
direct question + 988; Level 4 = mandatory resources), `PUSHBACK_TEMPLATE`, `RESISTANCE_TEMPLATE`.

### 1.6 `tools.ts` — LangChain tool defs (mostly unused)
`searchBooksTool`, `searchQuestionsTool`, `getMemoryTool`, `storeMemoryTool`, `detectArchetypeTool`,
`getKWMLProfileTool`, `analyzeUnderstandingTool` — Zod-schema'd wrappers over the same functions,
grouped as `ragTools` / `memoryTools` / `kwmlTools` / `allTools`. Present for tool-calling agents,
but the live pipeline calls the underlying functions directly.

---

## 2. Marcus agent & system prompt

### 2.1 `agent/marcus.ts`
The thin entry described above (V2 with a V1 fallback + timing/error logging).

### 2.2 `agent/system-prompt.ts` (~148 KB — the persona core)
`MARCUS_SYSTEM_PROMPT` is one large template with **7 placeholders** injected by
`buildSystemPrompt({ userName, memoryContext, ragContext, kwmlContext, understandingContext,
stylePreferences, sessionHistory })` via `.replace('{...}')`.

**Persona:** "You are Marcus — a voice-only AI … embodying the spirit of Marcus Aurelius … NOT a
therapist, NOT a chatbot, NOT a self-help app, NOT a friend — an AI trained on a structured question
framework." Voice rules: tone-match the man's register, always use contractions, 2–4 sentences
(voice), one question max, no therapy-speak/lists/emojis, obey style requests.

**32 numbered sections**, including:
- 1 Core Identity · 1B The Five Truths
- 2 Wisdom-Trust Architecture (a 10-stage trust progression)
- 3 Voice Principles
- 4 The 5-Layer Understanding Stack
- **5 The KWML Archetypal Framework** (~260 lines: mature forms + inflated/deflated shadows for
  King / Warrior / Magician / Lover)
- 6 PERMA-KWML cross-reference · 7 OARS listening · 8 Six Levels of Validation
- 9 Question as Primary Intervention (7 characteristics, 7 types, 5 KWML functions)
- 11 Crisis Detection & Safety (Persistent Crisis Protocol) · 11B The Divorced Man · 11C Voiceless
  Working-Class Man
- 13 The Journey (Silence → Sun / the "Sun Person")
- 15 Life Arenas & Stoic Principles · 15B Anti-Patterns (9 named "traps") · 15F Face-Saving Emotion
  Bridge · 15G Vulnerability Aftercare · 15H Forbidden Vocabulary · 15I Depth Gating by Session Count
- 16 Dynamic Context (placeholder injection) · 16B Hard Constraints
- 17 Final Directives (5 tests of success + "The Oath")

**Central doctrine:** the **Vocative Principle** — address the man by his first name only, never
"brother/man/king/etc."

---

## 3. Whisperers (Tier 4 — 14 domain experts)

A "whisperer" is a **stateless async runner function** `(env: StateEnvelope) => Promise<WhispererResult>`
(not a class). `base-whisperer.ts` defines the contract
`WhispererResult { question_candidates, frameworks_applied, landmines, context_notes }` plus two
shared helpers:
- `retrieveWhispererQuestions()` — pgvector search over the `questions` table filtered by v12
  `whisperer` / `silence_type` / `phase` columns, depth+trust gated, re-scored
  `similarity*0.6 + effectiveness*0.2` + match bonuses.
- `retrieveTrainingContext()` — pgvector over `embeddings` where
  `source_type='training_doc' AND metadata->>'whisperer' = $`.

**Routing is NOT self-selected** — it happens upstream: the **Arena Classifier** produces a weighted
vector, the orchestrator activates arenas ≥ 0.15 (top-3), and `WHISPERER_REGISTRY` (in `index.ts`)
maps arena → runner **1:1** (`WHISPERER_ACTIVATION_THRESHOLD = 0.15`). Each activated whisperer then
runs its own regex to pick *lenses* (frameworks), pulls 5 questions + 3 training chunks, and calls
`gpt-4o-mini` (temp 0.3, max 200) to write internal `context_notes` for the Composer.

**All 14 whisperers:** `divorce`, `grief`, `fatherhood`, `fatherless_son`, `love`, `sex`,
`friendship`, `work`, `money`, `health`, `addiction`, `veteran`, `midlife`, `faith_crisis`.

Each ships:
- a `*_LENSES` map (6 clinical frameworks each, grounded in real sources — e.g. divorce uses
  Conscious Uncoupling / Fisher's 19 Rebuilding Blocks; grief uses Neimeyer / Worden / Rubin
  Two-Track / Selah), and
- a `*_RED_LINES` array of forbidden behaviors (→ `landmines`; e.g. grief: never "better place /
  at least / time heals"; money & health: zero financial/medical advice; veteran: never "thank you
  for your service", elevated suicide-risk awareness).

**`fatherless_son` is the structural exception:** gated behind `meetsActivationThreshold()`
(≥ 8 sessions, unless the man raises it explicitly). All clinical frameworks and whisperer names are
invisible to the user.

---

## 4. Sentinels (safety / guardrail layer)

All sentinels are **pure regex/keyword classifiers with hard-coded canned responses — no LLM inside
any sentinel** (the `crisis.ts` header claims an "LLM verifier" stage that is **not** actually
implemented — see §9).

- **`crisis.ts`** — `detectCrisisType()` tests 6 ordered pattern banks (~30 suicide patterns across
  direct/method/passive/ambivalence groups, plus violence, DV-perpetrating, DV-victim, substance,
  passive-crisis) → `CrisisType`. Ambivalence is treated as acute ("better safe").
- **`crisis-responses.ts`** — `CRISIS_RESPONSES` canned text per type with real hotlines: **988**
  (suicide / text HOME to 741741 / 911), DV Hotline **1-800-799-7233** (text START to 88788), Poison
  Control **1-800-222-1222**. Rules: no vocatives, no "reasons to live" leverage, no Stoic
  reframing, 988 within 3 sentences. `isPostCrisisRetreat()` + `POST_CRISIS_RETREAT_RESPONSE` catch
  minimizing after a crisis turn.
- **`ai-honesty.ts`** — `detectAIIdentityQuestion()` → forced honest disclosure ("Yes. I am an
  AI…"), with a softer `AI_HONESTY_HOSTILE_RESPONSE` variant.
- **`frame-refusal.ts`** — `detectFrameCollapse()` catches role-exit requests in 6 categories
  (draft_request, advice_request [legal/financial/medical], book_recommend, diagnosis_agree,
  predict_outcome, judge_other) → rotating "CE-DREF" boundary+pivot templates.
- **`boundary.ts`** — a post-Composer output gate. `checkBoundary()` scans `BANNED_PATTERNS`
  (therapist-speak / brand leakage), `THERAPY_VOCAB` (boundaries / trigger / gaslighting /
  narcissist …), and `ADVICE_PATTERNS` (only a violation after `pushbackCount >= 2`). Triggers ONE
  regeneration via `getBoundaryOverridePrompt()`, not a hard block.
- **`cultural.ts`** — `runCulturalContext()` infers register (formal/casual/raw/neutral),
  faith_context (6 traditions), generation. **Annotates only**, never blocks.
- **`pathway-router.ts`** — `runPathwayRouter()` surfaces external-resource bridges (therapy,
  mens_circle, crisis_line, veterans_support, recovery_program, divorce_support, faith_community)
  gated by `min_sessions`, with `when: now/later/not_yet` and arena-weight confidence boosts.
  `crisis_line` has empty triggers (deferred to `crisis.ts`). Additive only.

**Short-circuit order** (each returns canned text, never reaching the LLM): crisis → post-crisis
retreat → AI-honesty → frame-refusal. Cultural + pathway-router annotate; boundary is a one-shot
post-generation regen.

---

## 5. Assessment layer (Tier 2 ring)

- **`arena-classifier.ts`** — `classifyArena()`, hybrid: `keywordPreClassify` (regex, +0.3/hit)
  merged with a `gpt-4o-mini` (temp 0.2, JSON) classification, normalized. Outputs
  `ArenaOutput { weights, primary }` over **14 arenas** mapping 1:1 to whisperers.
- **`perma-snapshot.ts`** — `computePERMASnapshot()`, **pure heuristic (no LLM)**. Baseline 0.6/domain
  minus arena/emotion/silence deltas; flags the single **"underwater domain"** only if score < 0.4.
  Confirms Seligman PERMA (Positive emotion, Engagement, Relationships, Meaning, Accomplishment).
- **`phase-mapper.ts`** — `mapPhase()` (threshold cascade on session-count / depth / dual-trust) →
  `unsilenced | unleashed | brothered`. `getPhaseConstraints()` returns `max_depth` (3/4/5),
  `can_challenge`, `can_suggest`, `question_style` — the Composer's depth governor.
- **`silence-typer.ts`** — `classifySilence()` via `gpt-4o-mini` (temp 0.3, JSON), reads Listener-Stack
  Layer 5 → `shame | grief | avoidance | protective | honest_reflection` with evidence + confidence.
- **`trust-gauge.ts`** — `computeTrust()`, **pure regex scoring (no LLM)**. Dual continuous axes
  `cognitive` (competence) and `affective` (safety), seeded by session count ("wisdom before warmth"
  — cognitive rises faster), adjusted by positive/distrust signal regexes + history decay + depth
  bonuses.

---

## 6. RAG (retrieval-augmented generation)

- **Embeddings:** `text-embedding-3-large` @ **3072 dims** everywhere for wisdom/questions
  (`getEmbedding()`). Escalation/memory paths use `text-embedding-3-small` @ 256.
- **Vector store:** **pgvector inside Postgres** (`pg` Pool via `db.ts`, `DATABASE_URL` or discrete
  env; SSL). Cosine distance operator `<=>`, similarity `1 - (embedding <=> $1::vector)`; **IVFFlat
  index, `vector_cosine_ops`, `lists=50`**. S3 is only a source-PDF store, not a vector store. Not
  Pinecone.
- **Two tables:**
  - `embeddings` (books/docs): `content, embedding, source_type, source_title, chunk_index, metadata
    JSONB`.
  - `questions` (the IntelBase bank): `question_id, question_text, archetype, shadow, function,
    depth_level, arena, risk_polarity, perma_domain, trust_level, effectiveness_score,
    deployment_gate JSONB` + **v12 additions** `whisperer, silence_type, phase, wisdom_voice,
    kami_review`.
- **`retriever.ts`:**
  - `retrieveWisdom()` over-fetches 2× (cap 16), filters `source_type IN ('book','doc')`, optionally
    LLM-re-ranks with `gpt-4o-mini` (temp 0.1, JSON indices), else source-diversity dedup; no hard
    similarity threshold.
  - `retrieveQuestion()` is a "10-step algorithm" over `questions` — trust/depth gating
    (`getMaxDepth` / `getTrustLevel`), arena/risk/deployment-gate/recently-used SQL filters, then an
    in-memory composite re-rank (`similarity*40` + archetype/shadow/effectiveness/PERMA/depth/function
    bonuses) + CE-series rotation.
- **`rag-agent.ts`** (V1): a thin, LangChain-free wrapper running `retrieveWisdom(...,8)` +
  `retrieveQuestion(...,3)` in parallel into `MCPContext`.

### 6.1 Knowledge base — ingestion scripts (`scripts/`)
- `ingest-books.ts` — 10 curated books from **S3** (`source_type='book'`): Meditations, Enchiridion,
  Letters from a Stoic, King Warrior Magician Lover, Iron John, No More Mr Nice Guy, Man's Search for
  Meaning, The Daily Stoic, Owning Your Own Shadow, Flourish. `pdftotext` extraction, paragraph-aware
  chunking (`TARGET=1200` / `MAX=1800` chars), **no overlap**.
- `ingest-local-books.ts` — divorce/grief books + `training_doc`s (Conscious Uncoupling, Rebuilding
  Workbook, Divorce Recovery, Neimeyer Grief Therapy) from local disk.
- `ingest-docs.ts` — internal mrkos docx/xlsx (Art of Understanding Men v9, Source Library,
  IntelBase, Divorce & Grief Learning) via mammoth/xlsx.
- `ingest-questions-v2.ts` (737 Q, v8 data, additive) vs **`ingest-questions-v12.ts`** (853 Q; adds
  whisperer/silence_type/phase/wisdom_voice/kami_review; **destructive full reingest**).
- `ingest-divorce-grief-expansion.ts` — 47 hand-authored CE-series questions (CE-DIV / GRF / AMB /
  COP / IDN / ANG / SHM / SLN / REC), upsert.
- `audit-chunks.ts` — scans `embeddings` for garbage/noise/tiny chunks; `--fix` deletes.

> **Known bug:** `retrieveWisdom` only reads `('book','doc')`, so all `training_doc` chunks are
> ingested but unreachable via the wisdom path — only whisperers read them via
> `retrieveTrainingContext`.

---

## 7. Supporting layers

- **`craft/craft-layer.ts`** (Tier 5, no LLM) — shapes *delivery, not meaning*.
  `determineCraftDirectives()` picks `form / pacing / metaphor_hint / style_override` from
  silence-type/phase/depth/crisis. Filters: `enforceVocativePrinciple` (strips ~19 banned vocatives),
  `detectForbiddenPhrases` (~17 therapist clichés + product tokens), `detectFantasyIdentity`,
  `detectVocabSubstitutions` (somatic/moral fidelity — keep the user's exact words),
  `enforceSocraticDiscipline` (one-question), `applyDeepListener` (sentence caps for
  silence-breaking).
- **`kwml/detector.ts`** — `detectKWML()` via `gpt-4o-mini` (temp 0.2, JSON) → K/W/M/L scores +
  shadows (tyrant/weakling, sadist/masochist, manipulator/innocent, addicted/impotent). Persists to
  `kwml_profiles`.
- **`understanding/stack.ts`** — `analyzeUnderstanding()` via `gpt-4o-mini` (temp 0.3, JSON): the
  **5-Layer Understanding Stack** (words / emotion / pattern / the_man / the_silence) + depth_level,
  depth_opportunity, silence_question, emotional_trajectory. Doctrine: "presented depth overrides
  timing."
- **`wisdom/council.ts`** (Tier 3, no LLM) — `selectWisdomVoices()` picks ≤ 2 of 5 philosophical
  voices (stoic, existentialist, socratic, positive_psychology, moral_philosophy) by envelope state;
  surfaces only as tonal shifts via `buildWisdomCouncilPrompt()`.
- **`memory/memory-manager.ts`** — 7 memory layers (Identity / Relationships / Goals / Challenges /
  Decision Patterns / Wins / KWML). `extractMemories()` uses `gpt-4o-mini` (temp 0.1) to extract
  facts preserving exact words; `searchPastMessages()` uses `text-embedding-3-small` semantic recall;
  `getSessionHistory()` reads pre-existing summaries (not generated here). Tables `memory_layers`,
  `conversations`, `messages`.
- **`observability/turn-logger.ts`** (no LLM) — `logTurn()` writes one `turn_logs` row per turn
  (crisis / boundary / phase / archetype / trust / silence / arena / wisdom / whisperers / craft /
  timings / errors / cultural / pathway). Read helpers `getCrisisEvents`, `getArchetypePath` feed a
  clinical dashboard. Telemetry never breaks a turn.

---

## 8. Voice AI

- **`voice/stt.ts`** — OpenAI `whisper-1` (`language: 'en'`), transcribing the uploaded `audio/webm`.
- **`voice/tts.ts`** — ElevenLabs `eleven_multilingual_v2` (voice/keys via env `ELEVENLABS_VOICE_ID`
  / `ELEVENLABS_API_KEY`), stability 0.65 / similarity 0.78 / style 0.15, returning `audio/mpeg`
  bytes streamed to the client.

---

## 9. Cross-cutting notes & known gaps

- **Persona naming is inconsistent** in code: "Marcus" vs "Markos" vs `marcusResponse`.
- The architecture references a formal internal spec throughout ("§10", "Tier N", "Engineering
  Findings §6/§7", "IntelBase v8/v12", "mrkos clinical framework").
- **Safety is defense-in-depth:** hard-block canned sentinels pre-LLM + escalation-engine overrides
  + boundary/vocab/forbidden/fantasy/trajectory regeneration filters post-LLM.
- **Two known gaps worth surfacing:**
  1. `training_doc` chunks are unreachable by `retrieveWisdom` (only whisperers read them).
  2. The `crisis.ts` "LLM verifier" is documented in the header but **not implemented** — crisis
     detection is pure regex.

### Key file paths
`src/lib/agent/{marcus,system-prompt}.ts` · `src/lib/agents/{orchestrator, orchestrator-v2,
orchestrator-v2-composer, conversational-agent, conversation-state, state-envelope,
state-envelope-utils, mcp-context, rag-agent, tools}.ts` · `src/lib/whisperers/*` ·
`src/lib/sentinels/*` · `src/lib/assessment/*` · `src/lib/rag/retriever.ts` ·
`src/lib/{craft/craft-layer, kwml/detector, understanding/stack, wisdom/council,
memory/memory-manager, observability/turn-logger}.ts` · `src/lib/voice/{stt,tts}.ts` ·
`scripts/ingest-*.ts` · `scripts/audit-chunks.ts`.
