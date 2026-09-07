'use client';

import PigmentPlate, { MARCUS_PLATES } from './PigmentPlate';

type ConvState = 'idle' | 'listening' | 'processing' | 'speaking';

/**
 * X-Emotion → register. The turn response carries X-Emotion — the understanding stack's
 * one-word primary_emotion (e.g. "grief" / "anger" / "shame" / "sadness"), or "neutral".
 * VoiceOrb now surfaces it up via onTranscript, so we map the emotion FAMILY to a 0..1
 * heaviness here. Coarse on purpose: it only nudges grain / speed / warmth. Returns null
 * for neutral / unknown / absent so the caller falls back to the lexical deriveRegister.
 */
export function emotionToRegister(emotion: string | null | undefined): number | null {
  if (!emotion) return null;
  const e = emotion.toLowerCase().trim();
  if (!e || e === 'neutral' || e === 'unknown') return null;
  // Heaviest family first; first match wins. Downstream this is only a scalar that reads as
  // slower + denser + a touch warmer — no hue, no alert colour.
  const FAMILIES: Array<[RegExp, number]> = [
    [/grief|griev|despair|hopeless|anguish|devastat|broke|numb|empty|hollow|mourn|loss/, 0.95],
    [/sad|sorrow|shame|ashamed|guilt|dread|fear|afraid|fright|scared|terror|lonel|hurt|pain|overwhelm|exhaust|trapp|helpless|heavy|regret/, 0.75],
    [/ang|rage|frustrat|anx|worr|stress|resent|conflict|confus|tense|irritat|unsettl|restless/, 0.5],
    [/hope|relief|reliev|calm|content|curious|reflect|determin|proud|steady|ready|clear/, 0.3],
    [/joy|happy|glad|grateful|gratitude|peace|love|excit|delight|warm|ease/, 0.15],
  ];
  for (const [re, w] of FAMILIES) if (re.test(e)) return w;
  return null; // unrecognized -> lexical fallback
}

/**
 * Lexical FALLBACK for register (0 = light, 1 = heavy), from Marcus's reply text — used when
 * X-Emotion is absent (e.g. the opening turn), "neutral", or an unrecognized word. Coarse +
 * slow on purpose: it only nudges grain / speed / warmth.
 */
const HEAVY = /\b(grief|griev\w*|loss|lost|died|death|dying|alone|lonel\w*|afraid|fear\w*|scared|shame\w*|ashamed|guilt\w*|hurt\w*|pain\w*|angry|anger|rage|numb|empty|hollow|heavy|weight|silence|silent|cry|cried|crying|tears|broke\w*|divorce\w*|regret\w*|failure|worthless|hopeless|drowning|can.?t breathe)\b/gi;
const LIGHT = /\b(proud|glad|grateful|gratitude|hope\w*|lighter|relief|relieved|better|joy\w*|peace\w*|steady|stronger|clear\w*|ready|good day)\b/gi;

export function deriveRegister(text: string): number {
  if (!text) return 0.2; // neutral-ish baseline
  const words = Math.max(1, text.trim().split(/\s+/).length);
  const heavy = (text.match(HEAVY) || []).length;
  const light = (text.match(LIGHT) || []).length;
  const r = 0.2 + (heavy / Math.sqrt(words)) * 0.9 - (light / Math.sqrt(words)) * 0.5;
  return Math.max(0, Math.min(1, r));
}

/** Same state/register inputs. Motion samples offline plates through Paper ShaderMount. */
export default function ShaderBackground({ state, register, contained = false, plates = MARCUS_PLATES }: {
  state: ConvState; register: number; contained?: boolean; plates?: readonly string[];
}) {
  const speed = { idle: .14, listening: .20, processing: .25, speaking: .22 }[state];
  return <PigmentPlate mode="field" register={register} speed={speed} plates={plates}
    style={{ position: contained ? 'absolute' : 'fixed', zIndex: 0 }} />;
}
