# Cutover Checklist — move-selector + Knowledge Intelligence policy wiring

This branch wires existing systems in place (no new orchestration layer).

| PR | Branch | State |
|----|--------|-------|
| #1 | `prompt-refactor/part1-core` | 6 v2 prompt modules; currently non-blocking for this cutover |
| #2 | `perf/latency-analysis` | tier parallelization + embedding memo + `total_ms`/`route_total_ms`/`regen_triggers` |
| #3 | `feature/conversation-intelligence` | CI layer writes on the live path (fire-and-forget); read-side still deferred |
| #4 | `feature/conversation-move-selector` | `selectMove` now wired into V2 policy path |
| #5 | `feature/move-ki-cutover` | Move + Knowledge Intelligence policy wiring and observability in V2 |

**B-items are must-fix before cutover; S-items are should-fix.
N-items are known debt.
Deferred items are tracked, not blocking.**

---

## ✅ B1 (RESOLVED) — non-asking move collision with question forcing

**Where:** `src/lib/agents/orchestrator-v2-composer.ts`

- `decision.ask_question === false` now suppresses `PRIORITY 1 — SILENCE QUESTION` and the suggested-questions block.
- `move` intent is emitted as an explicit move directive in the system context.
- Whisperer candidates and legacy questions are gated by effective policy before prompt assembly.

## ✅ B2 (RESOLVED) — `move -> craft.form` reconciliation

**Where:** `src/lib/agents/orchestrator-v2-composer.ts`, `src/lib/craft/craft-layer.ts`

- `MOVE_TO_FORM` is applied during orchestration via `applyMoveCraftPolicy(...)`.
- Non-question directives now clear question-like style override text where needed.
- `enforceSocraticDiscipline` strips question leakage for `presence`, `reflection`, and `statement` forms.

## S2 (DEFERRED) — placeholder replacement in v1/v2 prompt builder

**Where:** `src/app/agent/system-prompt.ts`

- Existing single-pass `.replace()` behavior remains a pre-existing issue outside this PR.
- Does not affect policy authority once wired; kept open for follow-up hardening.

---

## What is now wired in this PR

1. **Move policy (authoritative):**
   - `selectMove(env, conversationState, opts)` runs once per normal V2 turn in
     `src/lib/agents/orchestrator-v2.ts`.
   - Stored in `env.move_decision` and fed to the composer.

2. **Knowledge policy (scoped):**
   - `selectKnowledgePlan(env, moveDecision)` runs in the same tier.
   - Stored in `env.knowledge_plan` and used by retrieval and whisperer question
     gates.

3. **Composer enforcement:**
   - `orchestrator-v2-composer.ts` gates:
     - wisdom retrieval (`excludeDomains`, `towardDomains`),
     - question retrieval and RAG suggested questions,
     - whisperer question scope inclusion,
     - priority text (`ask` vs `non-ask` branch),
     - craft form reconciliation (`applyMoveCraftPolicy`),
     - post-generation `enforceMovePolicy` cleanup.

4. **Whisperer + question source compatibility:**
   - `QuestionRetrievalContext` now accepts `whispererScope` / `arenaScope`.
   - `retrieveQuestion` filters by scope when specified.

5. **Observability:**
   - `PolicyDiagnostics` added to envelope.
   - `turn-logger.ts` persists move/knowledge rule, conflict flags, retrieval flags,
     and final form/question counts.

6. **Feature flags:**
   - `MOVE_SELECTOR_ENFORCE`: controls enforcement
   - `KI_ENABLED`, `COMM_ASSIST_ENABLED`, `CI_CONTEXT_ENABLED` remain as existing.

---

## Deferred / unresolved items

### S3 / N1 — sentinel bypass persistence
`storeInBackground` runs only on the composer path; acute/crisis/AI-honesty/frame-refusal turns return before persistence and therefore do not write message/CI records.

### S3 — CI background completion on text path
`storeInBackground` is fire-and-forget; on text routes this can terminate before
CI promise work completes.

### N2 — non-atomic `people` merge in CI
`select/merge/update` approach may overwrite concurrent updates.

### N3 — emotional arc growth
`emotional_arc` is append-only and can grow long over many turns.

---

## Minimal “what changed” by file

- `src/lib/agents/orchestrator-v2.ts`
  - policy tier added (`selectMove`, `selectKnowledgePlan`), single call to
    conversation state for policy, policy passed to composer prefetch/run.
- `src/lib/agents/orchestrator-v2-composer.ts`
  - policy context plumbing, question suppression/inclusion, wisdom filters,
    move/craft reconciliation, policy conflict diagnostics.
- `src/lib/agents/state-envelope.ts`
  - policy fields: `move_decision`, `knowledge_plan`, `policy_diagnostics`.
- `src/lib/agents/state-envelope-utils.ts`
  - envelope defaults + context summary gating for question / whisperer context.
- `src/lib/craft/craft-layer.ts`
  - non-question form enforcement for question stripping.
- `src/lib/rag/retriever.ts`
  - scoped question params and optional wisdom domain exclusion / toward-domain
    soft boost.
- `src/lib/observability/turn-logger.ts`
  - policy columns and insert values for log-level analysis and mismatch detection.
