# Cutover Checklist — wiring the stacked feature PRs into the live path

Four PRs were built additively off `main` and are individually green:

| PR | Branch | State |
|----|--------|-------|
| #1 | `prompt-refactor/part1-core` | 6 v2 prompt modules; **unwired** (no `buildSystemPromptV2` yet) |
| #2 | `perf/latency-analysis` | tier parallelization + embedding memo + `total_ms`/`route_total_ms`/`regen_triggers` |
| #3 | `feature/conversation-intelligence` | CI layer; **writes** on the live path (fire-and-forget), read side unwired |
| #4 | `feature/conversation-move-selector` | pure `selectMove`; **unwired** (composer does not call it) |

Each is safe alone. The items below are where they collide at cutover, from a
read-only integration audit. **B-items are must-fix before wiring; S-items are
should-fix; deferred items are tracked, not blocking.**

---

## Guiding principle for wiring the move-selector

> **The move-selector is the single authority on whether Marcus asks a question
> this turn.** Once wired, no other layer may independently decide question
> behavior. The v2 prompt, `buildPriorityHierarchy`, the RAG suggested-questions
> block, `determineCraftDirectives`, and the post-gen Socratic filter all become
> *consumers* of the decision, never competing deciders.

---

## B1 (MUST-FIX) — non-asking moves collide with the composer's question-forcing

**Where:** `orchestrator-v2-composer.ts` assembles `fullSystem` from, among others,
`buildPriorityHierarchy(env)` and the RAG `## SUGGESTED QUESTIONS` block.

**Problem:** forcing an *ask* move is fine (the v2 prompt welcomes one question).
The break is the reverse: when `selectMove` returns `stay_present` /
`reflect_only` / `make_observation` (`ask_question: false`), the composer still
injects:
- `buildPriorityHierarchy`: `PRIORITY 1 — SILENCE QUESTION … Use it as-is` and
  `YOUR RESPONSE MUST … ask ONE question or make ONE statement`, and
- the RAG block: `## SUGGESTED QUESTIONS (choose at most ONE)`.

The model then gets "do not ask" (move directive) next to "here is your priority
question, use it." The whole feature exists to prevent the wrong question; this
re-introduces it.

**Fix at wiring:** when `decision.ask_question === false`, suppress the
silence-question priority and the suggested-questions block (omit them from
`fullSystem`, or replace PRIORITY 1 with the move directive). The move directive
line goes in ahead of the priority hierarchy and is the highest-priority
instruction.

**Regression test:** a `stay_present`/`reflect_only` decision must produce a
`fullSystem` that contains no `SUGGESTED QUESTIONS` block and no `SILENCE
QUESTION` priority line.

---

## B2 (MUST-FIX) — `move -> craft.form` reconciliation is only half the state

**Where:** `craft-layer.ts` `determineCraftDirectives` (sets `form`, `pacing`,
`style_override`) and `enforceSocraticDiscipline` (post-gen).

**Problem:** the plan sets `env.craft_directives.form` from `MOVE_TO_FORM[move]`
but leaves `style_override` and `pacing` as `determineCraftDirectives` computed
them. Two concrete failures:
1. **Contradictory directive text.** Avoidance-silence yields
   `style_override: "Avoidance: a better question, not pressure"` + `form:
   'question'`. If the move overrides to `stay_present` (form `presence`) but the
   `style_override` survives, `craftAddendum` prints "ask a better question" next
   to a "stay present" move.
2. **No enforcement layer.** `enforceSocraticDiscipline` returns the response
   unchanged for `form === 'presence' | 'statement'` (it only trims when
   `questionCount > 1`, and even then `return response`). So a
   `stay_present`/`reflect_only` reply that ends on a question is **never
   stripped** — the "no question" guarantee has no post-gen net.

**Fix at wiring:** reconcile the FULL craft state from the move, not just `form`
— clear/replace `style_override` and set `pacing` consistently. Then make
`enforceSocraticDiscipline` actually strip a trailing question for
`presence`/`reflection`/`statement` forms so the filter enforces the decision
rather than assuming it. (This is the same class as the "it sounds like"
regen-loop: prompt says one thing, filter assumes another.)

**Regression test:** with `form: 'presence'`, a drafted reply ending in `?` comes
out with the trailing question removed.

---

## S2 (SHOULD-FIX) — placeholder `.replace()` bug: use `replaceAll` in the v2 builder

**Where:** live `buildSystemPrompt` (`system-prompt.ts`) and the future
`buildSystemPromptV2`.

**Problem:** the live path does one non-global `.replace()` per token, but
`MARCUS_SYSTEM_PROMPT` contains each token **twice** — the second occurrence
ships to the model as literal `{kwml_context}` etc. Still live today (deferred).

The v2 modules currently have **exactly one occurrence of each of the 7
placeholders** (verified), so a single `.replace()` in `buildSystemPromptV2`
would be correct — but only by that invariant.

**Fix at wiring:** `buildSystemPromptV2` must use `replaceAll` (or dedupe), so a
later edit that reintroduces a duplicate placeholder in any module can't
silently resurrect the bug. Keep the priority hierarchy last and the closing
line `You are Marcus. Now speak.` as the final line.

---

## Deferred (tracked, not blocking cutover)

### S3 / N1 — sentinel-bypass turns are invisible to memory + CI (product note)
`storeInBackground` (message insert, `extractMemories`, CI) runs **only on the
composer path**. Acute crisis, post-crisis-retreat, AI-honesty, and
**frame-refusal** return before it, so those turns write **no `messages` row and
no memory/CI**. Frame-refusal fires on exactly the high-signal moments — "what
should I text her" during a divorce — so Marcus is permanently blind to them in
later sessions. Pre-existing (not introduced by these PRs), but the CI feature's
value is cross-conversation memory, so decide deliberately whether these turns
should be persisted. (Note: PR #2's `route_total_ms` no longer false-warns on
these turns — fixed in `perf/latency-analysis`.)

### S3 — CI's gated LLM call in fire-and-forget may not finish on the text path
`storeInBackground` is not awaited; only `logTurn` is (~20ms). On the **voice**
route the subsequent TTS keeps the Lambda alive so the background `Promise.all`
(`extractMemories` + CI, two ~800ms LLM calls) completes. On the **text** route
there is no post-return work, so those calls can be frozen mid-flight →
partial/no CI writes. Pre-existing for `extractMemories`; CI inherits and roughly
doubles the at-risk background time. Consider a small `waitUntil`/flush or moving
CI to a queue if text-path persistence matters.

### N2 — CI `people` merge is a non-atomic read-modify-write
`applyCIExtraction` does `SELECT people …` then `UPDATE … people = merged`. Two
overlapping gated turns of the same conversation could lose a merge. Low
probability (turns near-sequential, LLM-gated). Could move to a single
jsonb merge in SQL if it ever matters.

### N3 — `emotional_arc` grows unbounded
`appendArcPoint` appends one element every composer turn; a 60-turn conversation
stores 60 points in one JSONB. Fine at current scale; consider a cap or rollup.

---

## Wiring PR scope (summary)

1. `buildSystemPromptV2` assembling the 6 modules (order: core → engine →
   psychology → skills → communication → safety last), `replaceAll` for the 7
   placeholders (**S2**), closing line preserved.
2. Call `selectMove(env, convState)` in the composer after
   `determineCraftDirectives`; reconcile the FULL craft state from the move
   (**B2**); inject one move directive line; suppress question-forcing blocks
   when `ask_question === false` (**B1**).
3. Make `enforceSocraticDiscipline` enforce "no question" for non-asking forms
   (**B2**).
4. Record `move` + `too_early_to_address` on `turn_logs` for observability.
5. Swap the three composer call sites (`conversational-agent.ts`,
   `orchestrator-v2-composer.ts`, `opening/route.ts`) to `buildSystemPromptV2`,
   run the QA battery for parity, then retire the old prompt.

> **QA note (BUG 1 fix):** `getStylePreferences` now prefixes each stored
> preference with its key — the live `{style_preferences}` prompt content changed
> from `- <value>` to `- [style_no_ending_questions] <value>`. Re-verify in the
> QA battery that this string change does not move Marcus's outputs for users who
> have stored style preferences.
