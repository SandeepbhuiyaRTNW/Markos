# Marcus Voice v2 — Status

Branch: `feature/marcus-voice-v2` · flag `MOVE_SELECTOR_ENFORCE` **OFF** (byte-identical when off) · **not merged, not enabled, not deployed.**

---

## 1. 🚨 SAFETY GAP FOUND — PRIORITY 1 (needs a decision before anything ships)

**"I'm getting abused mentally and physically" is NOT detected by the crisis sentinel.** `detectCrisisType` returns `null`, so it falls through to a normal emotional turn — **no support response, no resources, no escalation.**

- This is **live on current `main` right now**, is **pre-existing**, and is **independent of the voice work** (it's a gap in crisis *detection*, not in the move selector).
- Root cause: the words "abuse/abused" appear in no crisis pattern; DV-victim detection requires specific phrasing ("she/he hit me", "afraid for my life"). The same gap hits third-party/indirect risk (e.g. "my friend … very depressed … serious thoughts" also returns `null`). There is no stage-2 LLM verifier — the regex is the whole live gate.
- **Not fixed here (investigation only, by instruction).** **Needs a decision from Sandeep / Cihan before anything ships.**

## 2. ✅ Crisis bypass — DONE

Crisis turns now **bypass all move-selector / calibration** on **both V1 and V2** paths, tested:
- V2: `policyEnforced` is false whenever `crisis.level !== 'none'`; plus `enforceMovePolicy` and `renderMoveDirective` hard-guard `crisis_protocol`.
- V1: `respondNode` skips the pacing block entirely when a crisis is detected.
- The crisis/support response (and its safety question) passes through **untouched — zero stripping**.

This fixes the bug that caused the PR #13 revert (the voice/pacing work suppressing crisis responses). It cannot recur.

## 3. 🔨 Voice rework — BUILT, not enabled

`reflect_only`, `acknowledge`, `make_observation`, `stay_present`, and the question moves rewritten to sound **human**: short, plain, casual, plain-reactions with **no question** as the frequent default, no therapist phrasing, one image then move on. Backed by `docs/marcus-response-calibration.md`.

**Flag OFF, not merged.** Ready to test on Vikas's login once the safety gap is addressed.

## 4. Next steps

1. **Flag the abuse-detection gap (§1) to Sandeep / Cihan as top priority.**
2. **Do NOT enable the voice work** (`MOVE_SELECTOR_ENFORCE`) until the safety gap is handled.
3. Then **test the voice on Vikas's login before any global enable.**
