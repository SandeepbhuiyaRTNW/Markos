'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GrainGradient } from '@paper-design/shaders-react';

type ConvState = 'idle' | 'listening' | 'processing' | 'speaking';

// ─────────────────────────────────────────────────────────────────────────────
// TUNING — every motion parameter lives here, on purpose. START CONSERVATIVE:
// @paper-design's defaults are tuned for demo appeal and are far too strong for
// an ambient backdrop behind a conversation. Adjust these by eye.
//
// Register (emotional heaviness, 0..1) maps ONLY to: grain density (noise),
// drift speed (SLOWER when heavier), and temperature (a warm↔cool blend within
// the existing parchment palette). Never hue, never darker. Conversation STATE
// is the primary driver; register is a slow modulation on top.
// ─────────────────────────────────────────────────────────────────────────────
const TUNING = {
  // Per-state base energy (PRIMARY). speed = drift; intensity = band movement;
  // noise = base grain. 'processing' (thinking) must clearly MOVE so it reads as
  // Marcus considering, not the app hanging.
  state: {
    idle: { speed: 0.3, intensity: 0.25, noise: 0.18 },
    listening: { speed: 0.55, intensity: 0.38, noise: 0.22 },
    processing: { speed: 0.85, intensity: 0.55, noise: 0.3 }, // thinking — steady, alive
    speaking: { speed: 1.0, intensity: 0.48, noise: 0.28 },
  } as Record<ConvState, { speed: number; intensity: number; noise: number }>,

  // Register modulation (SECONDARY, SLOW). Heavier = denser grain + slower drift
  // + warmer — never darker. Temperature is the cool↔warm colour blend below.
  register: {
    noiseAdd: 0.25, // heavier -> up to +0.25 grain density
    speedSlow: 0.55, // heavier -> up to 55% slower drift
  },

  // Easing (exponential smoothing; perceived transition ≈ 3 × tau, so nothing
  // snaps). State changes are fast-but-smooth; register crawls (8–15s band).
  stateTauMs: 650, // ≈ 2s to settle
  registerTauMs: 3600, // ≈ 10–11s to settle — inside the 8–15s band
  settleEps: 0.0015,
  emitIntervalMs: 33, // throttle React updates to ~30fps during transitions

  // Fixed look.
  shape: 'blob' as const, // soft organic form (no snapping shape changes)
  softness: 0.92, // smooth gradient, no hard edges
  scale: 1.3, // broad, calm blobs
} as const;

// Warm earth-tone palette — LITERAL hexes (no longer read from CSS vars) so they can be
// edited directly here while tuning. Saturated terracotta / ochre / clay / rust that read
// CLEARLY against the #faf9f6 cream colorBack; all in the terracotta earth family — no
// red/green/yellow signal, no mood-ring. Key names are historical (parchment/cream/
// coolStone/warmStone); what each HOLDS now is labelled per line, with the CSS var it
// replaced.
const PALETTE_FALLBACK = {
  background: '#faf9f6', // colorBack   — cream page colour, unchanged   (was --background)
  parchment: '#bf7d2c',  // OCHRE       — burnt golden earth            (replaces --parchment #e6e3dc)
  cream: '#b0611f',      // TERRACOTTA  — the core warm accent          (replaces --muted / --chart-3)
  coolStone: '#a86b4f',  // COOLER CLAY — register LIGHT endpoint       (replaces --hairline / --chart-4)
  warmStone: '#8a3f16',  // DEEPER RUST — register HEAVY endpoint       (replaces --chart-3 / --ink-3)
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
 * Derive the emotional register (0 = light, 1 = heavy) from Marcus's reply text.
 * This is what the client actually has: VoiceOrb surfaces X-Marcus-Text to the
 * parent via onTranscript. (X-Emotion is a sibling header, but VoiceOrb owns the
 * fetch and doesn't surface it — and adding a field/reading it would touch the
 * protected pipeline.) Coarse + slow on purpose: it only nudges grain/speed/warmth.
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
export default function ShaderBackground({ state, register, quiet = false }: { state: ConvState; register: number; quiet?: boolean }) {
  const [palette] = useState(PALETTE_FALLBACK); // literal earth tones; NOT overridden from CSS vars
  const [ready, setReady] = useState(false); // becomes true AFTER first paint
  const [reduceMotion, setReduceMotion] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [u, setU] = useState<Uniforms>({ ...TUNING.state.idle, warmth: register });

  // `quiet` (used behind the voice orb) reduces this to NEAR-STILL: the static gradient
  // still renders, the animated GrainGradient does not — so the orb is the only living
  // surface on that screen. Reduced-motion / no-WebGL already fall back the same way.
  const animate = ready && webglOk && !reduceMotion && !quiet;

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

  const colors = useMemo(
    () => [palette.parchment, palette.cream, lerpHex(palette.coolStone, palette.warmStone, u.warmth)],
    [palette, u.warmth],
  );

  // Static palette gradient — first paint + permanent fallback (reduced motion / no WebGL).
  // On the voice room (`quiet`) the ground must sit close to the original cream: the earth
  // tones were chosen for a MOVING field, not a flat page fill, so near-still => near-cream
  // (a whisper of warmth), never a saturated terracotta wash. The full earth gradient stays
  // as the non-quiet reduced-motion / no-WebGL fallback everywhere else.
  const staticGradient = quiet
    ? `radial-gradient(120% 110% at 50% 38%, #f3ece1 0%, #f7f2ea 55%, ${palette.background} 100%)`
    : `radial-gradient(120% 110% at 50% 38%, ${palette.cream} 0%, ${palette.parchment} 52%, ${palette.background} 100%)`;

  const effectiveSpeed = u.speed * (1 - u.warmth * TUNING.register.speedSlow);
  const effectiveNoise = u.noise + u.warmth * TUNING.register.noiseAdd;

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
          intensity={u.intensity}
          noise={effectiveNoise}
          speed={effectiveSpeed}
          fit="cover"
        />
      )}
    </div>
  );
}
