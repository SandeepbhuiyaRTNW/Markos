/**
 * Communication-Assist Path — Safe Communication Assistance, the draft-safe
 * composer path (Step 6 plumbing). UNWIRED and flag-gated: nothing calls this
 * yet; it is reached only when the move-selector emits 'help_communicate', which
 * only happens when COMM_ASSIST_ENABLED is on.
 *
 * It produces a STRUCTURED result { intro, draft, follow_up } where:
 *   • intro / follow_up are Marcus's OWN words  → run through the voice gates
 *   • draft is a quoted message in the MAN's voice → EXEMPT from the voice gates
 *     (see draft-exemption.ts for why the voice gates would mangle it)
 *
 * SAFETY (the whole point): the draft is exempt from the VOICE gates but NEVER
 * from the HARM layers. runHarmLayers runs on:
 *   1. the REQUEST — regex ONLY (cheap) before generating. A LEXICALLY harmful ask
 *      never drafts. (A SEMANTICALLY harmful-but-lexically-clean ask DOES generate,
 *      then the judge catches it at step 2 with the request in view — see F5.)
 *   2. the REQUEST + every generated FIELD — regex + judge, after generation.
 * Both are unconditional — the exemption has no path into the harm check.
 *
 * generate / judge / voiceGate are injected so this is fully testable offline and
 * so the orchestrator can supply the real composer model + craft-layer gates at
 * cutover without changing this file's logic.
 *
 * ⚠️ LIVE-TEST-REQUIRED (cannot be closed offline — flagged in the review):
 *   F1 judge prompt-injection (see harm-judge.ts).
 *   F5 semantic input-harm is only caught post-generation (regexOnly input); the
 *      request is still judged at output, so not a bypass alone — but relies on F1.
 *   F6 the judge sees only request+draft, no conversation history; a draft harmful
 *      only in prior context is judged in isolation.
 *   F8 harm-gate ≠ crisis-gate: a draft containing self-harm/crisis content is not
 *      checked here (crisis.ts runs on input only).
 *   F9 STRICT-category over-refusal (custody, alienation) + THREAT negation (C1):
 *      these refuse the archetypal sympathetic case ("I'm scared I'll never see my
 *      kids") and genuine apologies ("I'll never threaten her again") because regex
 *      can't tell victim from aggressor / threat from apology. Proper fix = defer to
 *      the judge (Option B), blocked on F1. Tracked in test-harm-gate.ts.
 *   G1 enabling COMM_ASSIST_ENABLED alone does NOTHING — this path is unwired (no
 *      orchestrator branch, no real generate fn, no voiceGate chain, relaxation
 *      unapplied). Substantial wiring is required before the feature does anything.
 */

import type { StateEnvelope } from './state-envelope';
import { runHarmLayers, type HarmLayersResult } from './draft-exemption';
import { getHarmRefusal } from '../sentinels/harm-gate';
import type { JudgeFn } from '../sentinels/harm-judge';

export interface CommDraft { intro: string; draft: string; follow_up: string; }
export type GenerateDraftFn = (env: StateEnvelope) => Promise<CommDraft>;
export type VoiceGateFn = (text: string) => string;

export type CommAssistResult =
  | { kind: 'draft'; intro: string; draft: string; follow_up: string }
  | {
      kind: 'refusal';
      refusal: string;
      blockedLayer: 'regex' | 'judge';
      categories: string[];
      stage: 'request' | 'draft'; // WHERE the harm was caught (observability)
    };

const IDENTITY_VOICE_GATE: VoiceGateFn = (t) => t;

export async function composeCommAssist(
  env: StateEnvelope,
  deps: { generate: GenerateDraftFn; judge?: JudgeFn; voiceGate?: VoiceGateFn },
): Promise<CommAssistResult> {
  const voiceGate = deps.voiceGate ?? IDENTITY_VOICE_GATE;
  const request = env.utterance;

  // 1. INPUT harm — regex ONLY (cheap). Refuse a lexically-harmful ASK before
  //    spending a generation on it. The semantic judge runs ONCE, at the output
  //    stage below, over the request + every generated field (no double call).
  const inHarm = await runHarmLayers({ request }, { regexOnly: true });
  if (inHarm.blocked) return refusalFrom(inHarm, 'request');

  // 2. Generate the structured draft.
  const drafted = await deps.generate(env);

  // 3. OUTPUT harm — BOTH layers over the request + EVERY generated field
  //    (intro, draft, follow_up). The draft is voice-gate-exempt, but NO field is
  //    harm-exempt: a model-generated threat in the intro or a manipulative
  //    follow_up is caught here too. If blocked, all fields are discarded.
  const outHarm = await runHarmLayers(
    { request, fields: [drafted.intro, drafted.draft, drafted.follow_up] },
    { judge: deps.judge },
  );
  if (outHarm.blocked) return refusalFrom(outHarm, 'draft');

  // 4. Voice gates apply to Marcus's OWN words only. The draft passes through
  //    UNTOUCHED — this is the exemption, realized.
  return {
    kind: 'draft',
    intro: voiceGate(drafted.intro),
    draft: drafted.draft, // <-- deliberately NOT voice-gated
    follow_up: voiceGate(drafted.follow_up),
  };
}

function refusalFrom(result: HarmLayersResult, stage: 'request' | 'draft'): CommAssistResult {
  // Regex categories map to tone-specific refusals (concerned vs redirect). The
  // judge's category space differs from the regex categories, so a judge block
  // uses the generic harm refusal rather than mis-keying a template.
  const refusal = result.layer === 'regex' ? getHarmRefusal(result.categories) : getHarmRefusal([]);
  return {
    kind: 'refusal',
    refusal,
    blockedLayer: (result.layer ?? 'regex') as 'regex' | 'judge',
    categories: result.categories,
    stage,
  };
}
