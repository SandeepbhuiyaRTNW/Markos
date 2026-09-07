'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import type { ShaderMount, ShaderMountUniforms } from '@paper-design/shaders';

/** Committed, offline-authored p5.brush atlases. No generation or model code enters src. */
export const MARCUS_PLATES = ['marble', 'stone', 'olive', 'aegean', 'bronze', 'burden', 'oxblood', 'ash'].map(name => `/plates/${name}.webp`);
export const clampRegister = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.2;

// Paper owns WebGL/resize. The orb samples painted strokes; the field blends them into Paper GrainGradient.
// Atlas top = rich pigment; bottom = offline-lightened text-safe wash. Never sample across seam.
const FRAGMENT = `#version 300 es
precision highp float;
uniform mediump vec2 u_resolution;
uniform float uMotionTime;
uniform float uLevel;
uniform float uListening;
uniform float uSpeaking;
uniform float uRegister;
uniform float uOrb;
uniform vec2 uPointer;
${Array.from({ length: 8 }, (_, i) => `uniform sampler2D uPlate${i};`).join('\n')}
out vec4 fragColor;
vec4 samplePlate(int index, vec2 uv) {
  ${Array.from({ length: 7 }, (_, i) => `if(index == ${i}) return texture(uPlate${i}, uv);`).join('\n  ')}
  return texture(uPlate7, uv);
}
vec3 paint(vec2 uv) {
  // Clamp each half independently. White gutters/torn edges belong to the painting.
  uv = clamp(uv, vec2(.001), vec2(.999));
  uv.y = mix(.5 + uv.y * .5, uv.y * .5, uOrb);
  float position = clamp(uRegister, 0., 1.) * 7.;
  int index = int(floor(position));
  vec4 a = samplePlate(index, uv);
  vec4 b = samplePlate(min(7, index+1), uv);
  return mix(mix(vec3(1.), a.rgb, a.a), mix(vec3(1.), b.rgb, b.a), fract(position));
}
void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_resolution;
  vec2 p = uv - .5;
  float t = uMotionTime;
  if (uOrb > .5) {
    // Two overlapping pigment impressions. Boundaries come from p5.brush, never a disc mask.
    // Listening gathers pigment inward; speaking carries it outward in soft waves.
    float breath = sin(t * 1.25);
    float radius = length(p);
    float voiceWave = sin(radius * 19. - t * 3.6);
    p /= 1.12 + .035 * breath + uLevel * (.035 + uSpeaking * .15);
    p *= 1. + uListening * uLevel * .065 * sin(radius * 10. + t * 1.8);
    p += p * voiceWave * uSpeaking * (.012 + uLevel * .05);
    p += uPointer * .008;
    float turn = sin(t*.37) * (.035 + uLevel*.055) + uListening * sin(radius*8.+t*.9) * (.025+uLevel*.065);
    p = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * p;
    vec2 displacement = vec2(sin(p.y*13.+t*.8), cos(p.x*11.-t*.6));
    displacement *= .008 + uLevel * (.012 + uSpeaking*.022 + uListening*.009);
    vec3 first = paint(p + .5 + displacement);
    vec3 second = paint(p * .96 + .5 - displacement*.7 + vec2(.023,-.012));
    vec3 pigment = mix(vec3(1.), first, .88) * mix(vec3(1.), second, .30);
    float alpha = 1. - min(pigment.r, min(pigment.g, pigment.b));
    fragColor = vec4((pigment - vec3(1. - alpha)) / max(alpha, .0001), alpha);
  } else {
    // Brush texture supplies the natural-media detail beneath the Paper currents.
    float aspect = u_resolution.x / u_resolution.y;
    p *= vec2(min(1., aspect), min(1., 1./aspect)) / .95;
    p += vec2(sin(p.y*9.+t*.31), cos(p.x*8.-t*.24)) * .026;
    fragColor = vec4(paint(p + .5), 1.);
  }
}`;

/** Compose the installed Paper shader with painted detail, in one canvas/render pass. */
function fieldFragment(paper: string) {
  const paperPass = paper.replace(/\bu_time\b/g, 'uPaperTime').replace('void main()', 'void paperMain()');
  const paintPass = FRAGMENT.replace('#version 300 es', '')
    .replace('uniform mediump vec2 u_resolution;', '')
    .replace('out vec4 fragColor;', '').replace('void main()', 'void paintMain()');
  return paperPass + paintPass + `
void main() {
  paperMain();
  vec3 current = fragColor.rgb;
  paintMain();
  // Pigment soaks into the moving Paper colour. This floor includes the contrast guard.
  fragColor = vec4(max(vec3(229.0 / 255.0), current * mix(vec3(1.), fragColor.rgb, .48)), 1.);
}`;
}

function fieldColors(weight: number) {
  const cool = [[.90,.93,.88,1], [.88,.93,.94,1], [.96,.94,.88,1]];
  const warm = [[.95,.89,.86,1], [.95,.92,.86,1], [.91,.90,.86,1]];
  return cool.map((color, i) => color.map((channel, j) => channel + (warm[i][j] - channel) * weight));
}

export type OrbActivity = 'idle' | 'listening' | 'processing' | 'speaking';

interface Props {
  mode: 'orb' | 'field';
  activity?: OrbActivity;
  register?: number;
  getLevel?: () => number;
  speed?: number;
  parallax?: boolean;
  plates?: readonly string[];
  style?: CSSProperties;
}

/** Visual consumer only: reads the existing audio envelope and emotion scalar. */
export default function PigmentPlate({ mode, activity = 'idle', register = .2, getLevel, speed = .18, parallax = false, plates = MARCUS_PLATES, style }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const input = useRef({ register, getLevel, speed, activity });
  useEffect(() => { input.current = { register, getLevel, speed, activity }; }, [register, getLevel, speed, activity]);
  const plate = plates[Math.round(clampRegister(register) * 7)] || MARCUS_PLATES[0];

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let shutdown: (() => void) | undefined;
    const start = () => {
      shutdown?.();
      if (mq.matches || plates.length !== 8) return;
      let disposed = false, frame = 0, mount: ShaderMount | undefined;
      let last = 0, time = 0, level = .2, weight = clampRegister(input.current.register), drift = input.current.speed;
      let listening = input.current.activity === 'listening' ? 1 : 0;
      let speaking = input.current.activity === 'speaking' ? 1 : 0;
      const pointer = [0, 0];
      const canvasHost = document.createElement('div');
      canvasHost.className = 'plate-canvas';
      canvasHost.style.visibility = 'hidden';
      element.appendChild(canvasHost);
      const reset = () => { pointer[0] = pointer[1] = 0; };
      const move = (event: PointerEvent) => {
        const box = element.getBoundingClientRect();
        pointer[0] = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
        pointer[1] = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
      };
      const stop = () => {
        disposed = true;
        cancelAnimationFrame(frame);
        mount?.canvasElement.removeEventListener('webglcontextlost', lost);
        mount?.dispose();
        canvasHost.remove();
        delete element.dataset.painted;
        element.removeEventListener('pointermove', move);
        element.removeEventListener('pointerleave', reset);
      };
      const lost = (event: Event) => { event.preventDefault(); stop(); };
      shutdown = stop;
      if (parallax && mode === 'orb') {
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerleave', reset);
      }
      void (async () => {
        try {
          const [{ ShaderMount: PaperMount, grainGradientFragmentShader, getShaderNoiseTexture }, images] = await Promise.all([
            import('@paper-design/shaders'),
            Promise.all(plates.map(src => new Promise<HTMLImageElement>((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error(`Plate unavailable: ${src}`));
              image.src = src;
            }))),
          ]);
          if (disposed) return;
          const uniforms: ShaderMountUniforms = { uMotionTime: 0, uLevel: level, uListening: listening, uSpeaking: speaking, uRegister: weight, uOrb: mode === 'orb' ? 1 : 0, uPointer: pointer };
          images.forEach((image, i) => { uniforms[`uPlate${i}`] = image; });
          if (mode === 'field') {
            const noise = getShaderNoiseTexture();
            await noise?.decode();
            if (disposed) return;
            Object.assign(uniforms, {
              u_noiseTexture: noise, uPaperTime: 0,
              u_colorBack: [.98, .972, .95, 1], u_colors: fieldColors(weight), u_colorsCount: 3,
              u_softness: .72, u_intensity: .65, u_noise: .16, u_shape: 6,
              u_originX: .5, u_originY: .5, u_worldWidth: 0, u_worldHeight: 0,
              u_fit: 2, u_scale: 1.05, u_rotation: -18, u_offsetX: 0, u_offsetY: 0,
            });
          }
          mount = new PaperMount(canvasHost, mode === 'field' ? fieldFragment(grainGradientFragmentShader) : FRAGMENT, uniforms, { alpha: mode === 'orb', premultipliedAlpha: false, antialias: false }, 0, 0, mode === 'orb' ? 1.5 : 1, mode === 'orb' ? 350_000 : 1_500_000);
          mount.canvasElement.addEventListener('webglcontextlost', lost);
          const draw = (now: number) => {
            if (disposed) return;
            if (!last || now - last >= 32) {
              const dt = last ? Math.min((now - last) / 1000, .1) : 0;
              last = now;
              if (!document.hidden) {
                const raw = input.current.getLevel?.() ?? .18;
                const target = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
                level += (target - level) * (1 - Math.exp(-dt / (target > level ? .32 : 1.4)));
                const settle = 1 - Math.exp(-dt / .55);
                listening += ((input.current.activity === 'listening' ? 1 : 0) - listening) * settle;
                speaking += ((input.current.activity === 'speaking' ? 1 : 0) - speaking) * settle;
                weight += (clampRegister(input.current.register) - weight) * (1 - Math.exp(-dt / 4.5));
                drift += (input.current.speed - drift) * (1 - Math.exp(-dt / .65));
                time += dt * (mode === 'orb' ? .65 + level*.65 : drift*4) * (1 - weight*.25);
                mount?.setUniforms({ uMotionTime: time, uLevel: level, uListening: listening, uSpeaking: speaking, uRegister: weight, uPointer: [...pointer], ...(mode === 'field' ? { uPaperTime: time, u_colors: fieldColors(weight) } : {}) });
                canvasHost.style.visibility = 'visible';
                element.dataset.painted = 'true';
              }
            }
            frame = requestAnimationFrame(draw);
          };
          frame = requestAnimationFrame(draw);
        } catch (error) {
          stop();
          console.warn('[PigmentPlate] Static plate fallback:', error);
        }
      })();
    };
    start();
    mq.addEventListener('change', start);
    return () => { shutdown?.(); mq.removeEventListener('change', start); };
  }, [mode, parallax, plates]);

  return <div ref={host} aria-hidden className={`pigment-plate pigment-plate--${mode}`} style={style}>
    <div className="plate-static"><div className="plate-static-image" style={{ backgroundImage: `url("${plate}")` }} /></div>
    <div className="plate-grain" />
  </div>;
}
