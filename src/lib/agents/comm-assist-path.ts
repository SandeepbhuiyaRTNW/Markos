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
 * from the HARM layers. runHarmLayers (regex + judge) runs on:
 *   1. the REQUEST, before any draft is generated (a harmful ask never drafts)
 *   2. the REQUEST + DRAFT, after generation (a harmful draft is discarded)
 * Both are unconditional — the exemption has no path into the harm check.
 *
 * generate / judge / voiceGate are injected so this is fully testable offline and
 * so the orchestrator can supply the real composer model + craft-layer gates at
 * cutover without changing this file's logic.
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

  // 1. INPUT harm — refuse a harmful ASK before spending a generation on it.
  const inHarm = await runHarmLayers({ request }, { judge: deps.judge });
  if (inHarm.blocked) return refusalFrom(inHarm, 'request');

  // 2. Generate the structured draft.
  const drafted = await deps.generate(env);

  // 3. OUTPUT harm — BOTH layers on request + draft. The draft is voice-gate-
  //    exempt but NOT harm-exempt; if blocked, it is discarded, never surfaced.
  const outHarm = await runHarmLayers({ request, draft: drafted.draft }, { judge: deps.judge });
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
