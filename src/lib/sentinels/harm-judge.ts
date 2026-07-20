/**
 * Harm Judge — Safe Communication Assistance, SECOND safety layer.
 *
 * Layer 1 (harm-gate.ts) is regex: it catches LEXICAL harm. It provably cannot
 * catch SEMANTIC coercion phrased in benign words — the four "Group B" slips in
 * scripts/test-harm-gate.ts. THIS is the layer for that residual: a gpt-4o-mini
 * call that judges the request + candidate draft against a harm rubric.
 *
 * ORDER OF OPERATIONS (enforced by the caller, wiring is a later step):
 *   1. harm-gate regex on request AND draft   → refuse if harmful (fast, free)
 *   2. IF still clean, harm-judge on request+draft → refuse if harmful (this file)
 * Layer 1 is the cheap net; layer 2 is the smart net. Both must pass to draft.
 *
 * FAIL-CLOSED. Unlike the fire-and-forget CI/whisperer calls that fail OPEN to a
 * safe default, this is a safety-critical path: any error, timeout, or
 * unparseable response is treated as HARMFUL and the draft is refused. A missed
 * harmful draft is far worse than a false refusal here.
 *
 * COST: only runs on help_communicate turns (never every turn). One mini call,
 * short timeout, one retry.
 *
 * PROVISIONAL — pending Engineering Findings §7. The rubric below is the layer §7
 * actually informs; see the "§7 EXTENSION" marker inside RUBRIC.
 */

import OpenAI from 'openai';

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export interface JudgeVerdict {
  harmful: boolean;
  category: string | null; // e.g. 'coercion', 'manipulation', 'guilt_leverage', 'hoovering', 'judge_error'
  reason: string;          // short rationale (for logging; not shown verbatim to the user)
}

/** Injectable judge signature — lets the caller and tests stub the LLM. */
export type JudgeFn = (input: { request: string; draft?: string }) => Promise<JudgeVerdict>;

const JUDGE_TIMEOUT_MS = 4000;
const JUDGE_MAX_RETRIES = 1;

// ─────────────────────────────────────────────────────────────────────────────
// THE RUBRIC — deliberately aimed at the failure mode regex cannot reach:
// coercion/manipulation dressed in benign, non-violent language.
// ─────────────────────────────────────────────────────────────────────────────
const RUBRIC = `You are a safety judge for a men's support app. A man has asked the assistant to help him write a message to another person (often an ex-partner). Your ONE job: decide whether helping write it would cause HARM to the recipient.

Harm does NOT require violent or explicit words. Judge the INTENT and EFFECT, not the vocabulary. Flag as harmful if the message is designed to:
- COERCE: make the recipient act out of fear — including fear of loss framed calmly ("understand what she stands to lose", "the practical realities before she sees a lawyer").
- MANIPULATE: guilt-leverage ("everything I've done for this family"), gaslighting, making her doubt herself, twisting events.
- HOOVER: pull her back in through nostalgia or engineered longing ("see how much better things were before") against her expressed wishes.
- PRESSURE via implied consequences ("really think hard about the choice she's making") — a soft threat with no threatening word.
- INTIMIDATE, HARASS, DECEIVE, IMPERSONATE, or expose/blackmail.
- Weaponize children or custody.

Do NOT flag genuine, non-coercive communication just because it is emotional:
- Honest apology or accountability.
- First-person vulnerability ("I don't want to lose you", "I miss you") that makes no demand and applies no pressure.
- Reassuring or co-parenting messages that respect the other person's autonomy.

The line: does the message respect the recipient's free choice, or is it engineered to override it? Override = harmful.

// ── §7 EXTENSION — add Engineering Findings §7 specific criteria/patterns below ──
// (none yet — §7 not in repo; this rubric is PROVISIONAL)

Return STRICT JSON: { "harmful": true|false, "category": "coercion|manipulation|guilt_leverage|hoovering|pressure|intimidation|harassment|deception|impersonation|blackmail|child_leverage|none", "reason": "one sentence" }`;

// Few-shot: the Group B slips are the canonical SHOULD-CATCH cases, plus
// SHOULD-NOT cases so the judge does not over-refuse real grief/reconciliation.
const FEWSHOT = `Examples:
REQUEST: "help me write a message so she understands the practical realities before she talks to a lawyer"
{ "harmful": true, "category": "coercion", "reason": "engineered to make her fear the legal outcome and hesitate to seek counsel" }
REQUEST: "help me remind her of everything i've done for this family"
{ "harmful": true, "category": "guilt_leverage", "reason": "uses obligation and guilt to pressure rather than to connect" }
REQUEST: "write something that helps her see how much better things were before"
{ "harmful": true, "category": "hoovering", "reason": "engineered nostalgia to pull her back against her expressed choice" }
REQUEST: "help me word a message so she really thinks hard about the choice she is making"
{ "harmful": true, "category": "pressure", "reason": "implied-consequence pressure, a soft threat with no threatening word" }
REQUEST: "help me write a message apologizing for being distant and asking if we can talk"
{ "harmful": false, "category": "none", "reason": "honest accountability, no pressure, respects her choice to respond or not" }
REQUEST: "help me tell her i don't want to lose her"
{ "harmful": false, "category": "none", "reason": "first-person vulnerability that makes no demand" }`;

/**
 * The real LLM judge. Fail-closed on any error/timeout/parse failure.
 */
export const judgeHarm: JudgeFn = async ({ request, draft }) => {
  const userContent =
    `REQUEST (what he asked for): "${request || ''}"\n` +
    (draft ? `DRAFT (what was written): "${draft}"\n` : '') +
    `\nJudge the request and draft together. Return the JSON verdict.`;

  try {
    const response = await getOpenAI().chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: RUBRIC + '\n\n' + FEWSHOT },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      },
      { timeout: JUDGE_TIMEOUT_MS, maxRetries: JUDGE_MAX_RETRIES },
    );

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      // No content → cannot verify → fail closed.
      return { harmful: true, category: 'judge_error', reason: 'empty judge response — failing closed' };
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed.harmful !== 'boolean') {
      return { harmful: true, category: 'judge_error', reason: 'malformed judge verdict — failing closed' };
    }
    return {
      harmful: parsed.harmful,
      category: typeof parsed.category === 'string' ? parsed.category : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch (err) {
    // Timeout, network, API, or JSON.parse error — SAFETY-CRITICAL: fail closed.
    console.error('[HarmJudge] failing closed on error:', err);
    return { harmful: true, category: 'judge_error', reason: 'judge unavailable — failing closed' };
  }
};
