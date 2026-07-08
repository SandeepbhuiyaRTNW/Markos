# Cutover Checklist — wiring the stacked feature PRs into the live path

> **Merge note:** the `feature/conversation-move-selector` branch also carries a
> `docs/CUTOVER-CHECKLIST.md` with the move-selector wiring items (B1: suppress
> question-forcing on non-asking moves; B2: full craft-form reconciliation +
> Socratic-filter enforcement; S2: `replaceAll` for the v2 prompt placeholders;
> plus the deferred items). At cutover, merge the two files — this copy holds the
> **Knowledge Intelligence (KI)** slice.

---

## Knowledge Intelligence — wiring (deferred to the cutover PR)

KI v1 ships the pure `selectKnowledgePlan` + `KnowledgePlan` type + 35 offline
tests, **feature-flagged (`KI_ENABLED`, default OFF → passthrough) and UNWIRED**
(nothing in the composer calls it). To wire it:

### (a) `retrieveWisdom` needs an optional `excludeDomains` param + composer wiring
- **`retrieveWisdom` (`src/lib/rag/retriever.ts`)** currently does
  `... FROM embeddings WHERE source_type IN ('book','doc') ORDER BY embedding <=> $1 LIMIT $2`
  with no domain filter (searches everything every turn). Add an optional
  `excludeDomains: string[]` param and, when non-empty, append
  `AND (metadata->>'domain' IS NULL OR metadata->>'domain' <> ALL($n::text[]))`.
  The `IS NULL` branch keeps **untagged books** (no `domain` in `metadata`) in
  the result — exclusion drops only the named heavy domains, never silently
  everything. No schema change — `metadata` is `JSONB` and `source_type` is a
  real column, both queryable today. Backward-compatible: omit the param →
  identical to current behavior.
  - **Verify this predicate against a real DB at cutover** — it cannot be tested
    here without DB access.
- **Composer:** after the move-selector runs, call
  `selectKnowledgePlan(env, decision)` behind `KI_ENABLED`; pass
  `plan.wisdom.excludeDomains` into `retrieveWisdom`; gate the RAG/questions
  block on `plan.wisdom.enabled` / `plan.questions.enabled`; scope the whisperer
  question candidates by `plan.questions.whispererScope` (divorce) /
  `arenaScope` (grief); honor `plan.safetyOnly` (crisis) and
  `plan.includeWhispererOutput`.
- `plan.towardDomains` is a **soft** preference (bonus-if-present) — optional
  ORDER-BY boost; the exclusion is the guaranteed win and must ship first.
- **Exclusion is DB-state-independent**; `towardDomains` degrades to
  empty-retrieval → prompt/whisperer fallback if that corpus is absent. Never
  emit a query that assumes divorce/grief rows exist.
- KI consumes the move-selector's `MoveDecision` **structurally** (`move`,
  `too_early_to_address`, `child_centered_frame`) — no import coupling; the real
  `MoveDecision` satisfies KI's `MoveDecisionInput` at cutover.

### (b) Two production findings for the founder (verified against the ingest code)
1. **Divorce questions are tagged `arena='relationship'`, not `arena='divorce'`**
   (`ingest-divorce-grief-expansion.ts`: CE-DIV/CE-AMB/CE-COP all
   `arena='relationship', whisperer='divorce'`). So
   **`retrieveQuestion(arena='divorce')` silently misses every divorce question
   today** — they are only reachable via `retrieveWhispererQuestions(whisperer='divorce')`.
   KI routes divorce question scope through the whisperer key accordingly. If the
   questions are ever re-tagged to `arena='divorce'`, revisit. (Grief questions
   carry both `arena='grief'` and `whisperer='grief'`, so they're fine either way.)
2. **The divorce/grief BOOK corpus loads from a local founder path**
   (`ingest-local-books.ts` → `/Users/sandeepbhuiya/Documents/...`), so its
   presence in prod is **unverified**. The main S3 corpus (`ingest-books.ts`:
   stoic/kwml/masculinity/meaning/shadow/perma) is the reliable one — which is
   exactly why KI is exclusion-first (excluding the psych corpus works whether or
   not the divorce/grief books are present).
