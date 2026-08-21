'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GrainGradient } from '@paper-design/shaders-react';

type ConvState = 'idle' | 'listening' | 'processing' | 'speaking';

// ─────────────────────────────────────────────────────────────────────────────
// TUNING — every motion parameter lives here, on purpose. START CONSERVATIVE:
// @paper-design's defaults are tuned for demo appeal and are far too strong for
// an ambient backdrop behind a conversation. Adjust these by eye.
//
// Register (emotional heaviness, 0..1 — from X-Emotion, lexical fallback) moves the field
// WITHIN a muted, desaturated palette along FOUR channels: temperature (cool sage/blue ->
// warm clay/amber), depth (intensity), density (grain), and drift speed (SLOWER when
// heavier). It never maps an emotion to a signal colour — you should SEE the field change
// without being able to read a diagnosis off it. Conversation STATE only sets a quiet base
// energy that stays SLOWER and quieter than the orb's own motion.
// ─────────────────────────────────────────────────────────────────────────────
const TUNING = {
  // Per-state base energy (PRIMARY). speed = drift; intensity = band movement;
  // noise = base grain. 'processing' (thinking) must clearly MOVE so it reads as
  // Marcus considering, not the app hanging.
  state: {
    idle: { speed: 0.05, intensity: 0.25, noise: 0.13 },
    listening: { speed: 0.08, intensity: 0.28, noise: 0.15 },
    processing: { speed: 0.12, intensity: 0.34, noise: 0.18 }, // thinking — still clearly moving, but SLOWER than the orb
    speaking: { speed: 0.09, intensity: 0.3, noise: 0.16 },
  } as Record<ConvState, { speed: number; intensity: number; noise: number }>,

  // Register modulation (SECONDARY, SLOW). Heavier = denser grain + slower drift
  // + warmer — never darker. Temperature is the cool↔warm colour blend below.
  register: {
    noiseAdd: 0.12, // heavier -> denser grain
    speedSlow: 0.6, // heavier -> up to 60% slower drift
    intensityAdd: 0.1, // heavier -> deeper colour (the "depth" channel)
  },

  // Easing (exponential smoothing; perceived transition ≈ 3 × tau, so nothing
  // snaps). State changes are fast-but-smooth; register crawls (8–15s band).
  stateTauMs: 650, // ≈ 2s to settle
  registerTauMs: 4500, // emotion crawls: perceived transition ≈ 3×tau ≈ 13s — felt, not noticed
  settleEps: 0.0015,
  emitIntervalMs: 33, // throttle React updates to ~30fps during transitions

  // Fixed look.
  shape: 'blob' as const, // soft organic form (no snapping shape changes)
  softness: 0.92, // smooth gradient, no hard edges
  scale: 1.1, // broad, calm blobs — a hair tighter so the distinct hues read as colour
} as const;

// MUTED palette — LITERAL hexes, edited directly here. Low-saturation, mid-to-light colour
// that reads CLEARLY as colour (warm sage / dusty blue-grey / soft clay / muted amber /
// warm stone) but never vivid, never alarm-coloured. Emotional weight slides the field from
// the COOL trio (calm) toward the WARM trio (heavy) — a temperature move, not a per-emotion
// colour. Every tone is light enough (L>=0.76) that even at the heaviest end heading +
// transcript stay >=9:1 (well past the 7:1 floor) and the faintest muted text stays >=4.6:1.
const PALETTE_FALLBACK = {
  background: '#eeebe2', // colorBack — neutral muted base the field sits on
  // COOL trio — dominant at LIGHT emotional weight (calm)
  sage: '#dce9c8',       // warm sage — muted green
  dustyBlue: '#dae5ec',  // dusty blue-grey (blue is the max channel)
  stoneLight: '#e6e4da', // light cool stone
  // WARM trio — the field slides TOWARD these as weight rises (heavy)
  clay: '#f0e0d0',       // soft clay
  amber: '#f4e7bc',      // muted amber
  stoneDeep: '#ede2d0',  // warm "deep" stone (lightened to hold text contrast)
};

// ── colour helpers (RGB lerp so temperature stays a warm↔cool blend, not a hue) ──
function hexToRgb(h: string): [number, number, number] {
  const s = h.trim().replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const i = parseInt(n || '000000', 16);
  return [(i >> 16) & 255, (i >> 8) & 255, i & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const t = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
  return `#${t(r)}${t(g)}${t(b)}`;
}
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

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

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

interface Uniforms {
  speed: number;
  intensity: number;
  noise: number;
  warmth: number; // 0 = cool stone, 1 = warm stone (temperature)
}

/**
 * Ambient Paper Shaders backdrop for the voice room. Presentation only — it reads
 * conversation state + a slow emotional register and never touches the pipeline.
 *
 * - Renders a static palette gradient FIRST (first paint, and the permanent
 *   fallback). The WebGL GrainGradient mounts only AFTER first paint, and only
 *   when motion is allowed and WebGL is present — so the orb paints first and the
 *   view still works with no WebGL / reduced motion.
 */
export default function ShaderBackground({ state, register }: { state: ConvState; register: number }) {
  const [palette] = useState(PALETTE_FALLBACK); // literal earth tones; NOT overridden from CSS vars
  const [ready, setReady] = useState(false); // becomes true AFTER first paint
  const [reduceMotion, setReduceMotion] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [u, setU] = useState<Uniforms>({ ...TUNING.state.idle, warmth: register });

  const animate = ready && webglOk && !reduceMotion;

  // Defer the WebGL canvas to the NEXT frame so it never blocks first paint. Isolated in
  // its own effect so nothing else can prevent readiness from being set.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // reduced-motion (live) + WebGL availability.
  useEffect(() => {
    const webgl = hasWebGL();
    setWebglOk(webgl);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof (mq as unknown as { addListener?: (cb: () => void) => void }).addListener === 'function') (mq as unknown as { addListener: (cb: () => void) => void }).addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange);
      else if (typeof (mq as unknown as { removeListener?: (cb: () => void) => void }).removeListener === 'function') (mq as unknown as { removeListener: (cb: () => void) => void }).removeListener(onChange);
    };
  }, []);

  // ── Eased transitions (exponential smoothing; nothing snaps) ──
  const stateRef = useRef(state);
  const registerRef = useRef(register);
  const animateRef = useRef(animate);
  const easedRef = useRef({ ...TUNING.state.idle, r: register });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const lastEmitRef = useRef(0);

  const emit = useCallback((e: { speed: number; intensity: number; noise: number; r: number }) => {
    setU({ speed: e.speed, intensity: e.intensity, noise: e.noise, warmth: e.r });
  }, []);

  const step = useCallback((ts: number) => {
    const e = easedRef.current;
    if (!lastTsRef.current) lastTsRef.current = ts;
    const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
    lastTsRef.current = ts;
    const target = TUNING.state[stateRef.current];
    const rTarget = Math.max(0, Math.min(1, registerRef.current));
    const ks = 1 - Math.exp(-dt / (TUNING.stateTauMs / 1000));
    const kr = 1 - Math.exp(-dt / (TUNING.registerTauMs / 1000));
    e.speed += (target.speed - e.speed) * ks;
    e.intensity += (target.intensity - e.intensity) * ks;
    e.noise += (target.noise - e.noise) * ks;
    e.r += (rTarget - e.r) * kr;
    if (ts - lastEmitRef.current > TUNING.emitIntervalMs) { lastEmitRef.current = ts; emit(e); }
    const settled =
      Math.abs(target.speed - e.speed) < TUNING.settleEps &&
      Math.abs(target.intensity - e.intensity) < TUNING.settleEps &&
      Math.abs(target.noise - e.noise) < TUNING.settleEps &&
      Math.abs(rTarget - e.r) < TUNING.settleEps;
    if (settled) { emit(e); rafRef.current = null; }
    else rafRef.current = requestAnimationFrame(step);
  }, [emit]);

  const kick = useCallback(() => {
    if (!animateRef.current || rafRef.current != null) return;
    lastTsRef.current = 0;
    rafRef.current = requestAnimationFrame(step);
  }, [step]);

  useEffect(() => { stateRef.current = state; kick(); }, [state, kick]);
  useEffect(() => { registerRef.current = register; kick(); }, [register, kick]);
  useEffect(() => {
    animateRef.current = animate;
    if (animate) kick();
    return () => { if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; } };
  }, [animate, kick]);

  // Temperature = the emotional-weight slide from the COOL trio to the WARM trio, a per-slot
  // RGB lerp (never a hue jump) so the field warms as ONE — no single colour "means" anything.
  const colors = useMemo(
    () => [
      lerpHex(palette.sage, palette.clay, u.warmth),
      lerpHex(palette.dustyBlue, palette.amber, u.warmth),
      lerpHex(palette.stoneLight, palette.stoneDeep, u.warmth),
    ],
    [palette, u.warmth],
  );

  // Static gradient — first paint + permanent fallback (reduced motion / no WebGL). A soft
  // muted-cool blend from the calm trio; light enough that text contrast holds here too.
  const staticGradient = `radial-gradient(120% 110% at 50% 38%, ${palette.sage} 0%, ${palette.dustyBlue} 52%, ${palette.background} 100%)`;

  const effectiveSpeed = u.speed * (1 - u.warmth * TUNING.register.speedSlow);
  const effectiveNoise = u.noise + u.warmth * TUNING.register.noiseAdd;
  const effectiveIntensity = Math.min(1, u.intensity + u.warmth * TUNING.register.intensityAdd);

  return (
    <div
      aria-hidden
      className="pointer-events-none"
      // Full-viewport ambient layer. position:FIXED (not absolute) so it never depends on
      // the voice room's height chain resolving — the earlier "nothing renders" was a
      // zero-size box. Explicit width/height keep the box definite in every engine, which
      // the library needs (it sizes the WebGL canvas from this subtree's measured box).
      // zIndex:0 keeps it behind the room's z-10 content while the room's own background
      // paints beneath it; pointer-events:none so it never intercepts clicks.
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: staticGradient }} />
      {animate && (
        <GrainGradient
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
          colors={colors}
          colorBack={palette.background}
          shape={TUNING.shape}
          softness={TUNING.softness}
          scale={TUNING.scale}
          intensity={effectiveIntensity}
          noise={effectiveNoise}
          speed={effectiveSpeed}
          fit="cover"
        />
      )}
    </div>
  );
}
