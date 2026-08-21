'use client';

import { useEffect, useRef, useState } from 'react';
import { GrainGradient } from '@paper-design/shaders-react';

type ConvState = 'idle' | 'listening' | 'processing' | 'speaking';

// ─────────────────────────────────────────────────────────────────────────────
// ORB TUNING — every value that shapes the orb's living surface, in one place
// (same pattern as ShaderBackground's TUNING). The surface is driven PRIMARILY by
// live audio amplitude — the mic while you speak, Marcus's playback while he speaks —
// fed through a SLOW-attack / SLOWER-release envelope so it reads as a presence
// responding to being spoken to, never a frame-by-frame volume meter. Idle and
// 'processing' (thinking) are state-driven, with no audio.
// ─────────────────────────────────────────────────────────────────────────────
export const ORB = {
  // Amplitude envelope. Slow attack, SLOWER release (perceived transition ≈ 3 × tau).
  attackTauMs: 320,
  releaseTauMs: 1400,
  emitIntervalMs: 33, // throttle React updates to ~30fps

  // Output analyser window (VoiceOrb reads raw RMS from this; power of two).
  fftSize: 512,

  // Raw RMS is small; scale into ~0..1 before the envelope, then clamp.
  inputGain: 6.0, // VAD mic-frame RMS  -> level  (user speaking)
  outputGain: 3.0, // playback RMS      -> level  (Marcus speaking)

  // Per-state BASE look at level 0. speed/intensity are GrainGradient params; opacity is
  // the whole surface's presence over the pearlescent stone underneath.
  base: {
    idle: { speed: 0.1, intensity: 0.1, opacity: 0.3 },
    listening: { speed: 0.16, intensity: 0.14, opacity: 0.4 },
    processing: { speed: 0.3, intensity: 0.24, opacity: 0.48 }, // steady, alive — considering, not hung
    speaking: { speed: 0.18, intensity: 0.16, opacity: 0.44 },
  } as Record<ConvState, { speed: number; intensity: number; opacity: number }>,

  // How much the audio envelope ADDS on top of the base — the "responds to voice" gain.
  speedGain: 0.9,
  intensityGain: 0.5,
  opacityGain: 0.5,

  // Fixed GrainGradient look. Warm surface (no hue mood-ring); louder = warmer / brighter.
  shape: 'blob' as const,
  softness: 0.9,
  scale: 1.1,
  noise: 0.12,
  blendMode: 'soft-light' as const, // let the stone's pearlescent depth read through
  colors: ['#f2eee6', '#d8b48c', '#b0611f'], // cream -> warm sand -> terracotta
  colorBack: '#cbb8a3', // warm stone under the shader
};

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

interface OrbUniforms {
  speed: number;
  intensity: number;
  opacity: number;
}

/**
 * A Paper Shaders surface rendered INSIDE the voice orb, masked to its circle. It reads
 * conversation state + live audio levels (VoiceOrb's own VAD mic frames, and an
 * AnalyserNode on the existing playback element) and drives the surface through an eased
 * amplitude envelope. Presentation only — it never touches mic/VAD/fetch/playback.
 *
 * Degrades cleanly: with no WebGL or under prefers-reduced-motion it renders NOTHING, so
 * the orb keeps its existing pearlescent-stone appearance underneath.
 */
export default function OrbShader({
  state,
  levelsRef,
}: {
  state: ConvState;
  levelsRef: { current: { input: number; output: number } };
}) {
  const [ready, setReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [webglOk, setWebglOk] = useState(true);
  const [u, setU] = useState<OrbUniforms>({ ...ORB.base.idle });

  const animate = ready && webglOk && !reduceMotion;

  // Mount the WebGL canvas after first paint so the orb paints instantly.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // WebGL availability + live prefers-reduced-motion.
  useEffect(() => {
    setWebglOk(hasWebGL());
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

  // Envelope + uniform RAF. Runs while animate (audio changes every frame); reads the
  // live level for the current state and eases it (slow attack, slower release).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const envRef = useRef(0);
  const lastTsRef = useRef(0);
  const lastEmitRef = useRef(0);

  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    lastTsRef.current = 0;
    const step = (ts: number) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      const s = stateRef.current;
      const lv = levelsRef.current;
      const raw =
        s === 'listening' ? lv.input * ORB.inputGain :
        s === 'speaking' ? lv.output * ORB.outputGain :
        0; // idle / processing — state-driven, no audio
      const target = Math.max(0, Math.min(1, raw));
      const tau = target > envRef.current ? ORB.attackTauMs : ORB.releaseTauMs;
      const k = 1 - Math.exp(-dt / (tau / 1000));
      envRef.current += (target - envRef.current) * k;
      const env = envRef.current;
      if (ts - lastEmitRef.current > ORB.emitIntervalMs) {
        lastEmitRef.current = ts;
        const b = ORB.base[s];
        setU({
          speed: b.speed + env * ORB.speedGain,
          intensity: Math.min(1, b.intensity + env * ORB.intensityGain),
          opacity: Math.min(1, b.opacity + env * ORB.opacityGain),
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate, levelsRef]);

  if (!animate) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, borderRadius: '50%', overflow: 'hidden',
        opacity: u.opacity, mixBlendMode: ORB.blendMode, pointerEvents: 'none',
      }}
    >
      <GrainGradient
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        colors={ORB.colors}
        colorBack={ORB.colorBack}
        shape={ORB.shape}
        softness={ORB.softness}
        scale={ORB.scale}
        noise={ORB.noise}
        intensity={u.intensity}
        speed={u.speed}
        fit="cover"
      />
    </div>
  );
}
