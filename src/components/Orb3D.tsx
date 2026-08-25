'use client';

import { useEffect, useRef, useState } from 'react';

// The orb, in Three.js — one component, one shader, used on the landing page (slow
// oscillator) AND in the voice room (live audio envelope via getLevel). SphereGeometry +
// a custom ShaderMaterial: 3D simplex noise displaces the surface so it churns/swells, a
// fresnel rim catches warm light, and grain matches the paper field. uLevel drives the
// displacement amplitude. Pointer parallax eases the orb, motes and camera.
//
// Lazy-inits AFTER first paint, behind a static warm gradient. No WebGL / reduced-motion =>
// the static gradient stays and the page is fully usable. ANY init/compile error also falls
// back to the gradient — the orb can never break the screen.

const VERT = `
uniform float uTime;
uniform float uLevel;
varying float vFres;
varying float vDisp;
// Ashima simplex noise (3D)
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+1.0*C.xxx; vec3 x2=x0-i2+2.0*C.xxx; vec3 x3=x0-1.0+3.0*C.xxx;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
void main(){
  vec3 pos=position;
  float n1=snoise(normal*1.6+uTime*0.22);
  float n2=snoise(normal*3.4-uTime*0.13);
  float disp=n1*0.62+n2*0.38;
  float amp=0.09+uLevel*0.30;
  pos+=normal*disp*amp;
  vDisp=disp;
  vec4 wp=modelMatrix*vec4(pos,1.0);
  vec3 nW=normalize(mat3(modelMatrix)*normal);
  vec3 viewDir=normalize(cameraPosition-wp.xyz);
  vFres=pow(1.0-max(dot(viewDir,nW),0.0),2.6);
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;

const FRAG = `
precision highp float;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uRim;
uniform float uTime;
varying float vFres;
varying float vDisp;
float hash(vec2 p){return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453);}
void main(){
  vec3 base=mix(uColorA,uColorB,smoothstep(-0.55,0.65,vDisp));
  vec3 col=base+uRim*vFres*1.15;
  col+=(hash(gl_FragCoord.xy+fract(uTime))-0.5)*0.045; // grain, matched to the paper field
  gl_FragColor=vec4(col,1.0);
}`;

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}
function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Warm static fallback — also the first-paint layer behind the lazy canvas.
const STATIC_BG = 'radial-gradient(circle at 36% 32%, #f4ecdd 0%, #e6d7c0 42%, #b9a888 78%, #8a7a63 100%)';

interface Orb3DProps {
  /** 0..1 target displacement level. Landing: omit -> slow oscillator. Voice: live envelope. */
  getLevel?: () => number;
  size?: number;          // px (square)
  parallax?: boolean;     // pointer parallax (default true)
  className?: string;
  style?: React.CSSProperties;
}

export default function Orb3D({ getLevel, size = 220, parallax = true, className, style }: Orb3DProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const getLevelRef = useRef(getLevel);
  useEffect(() => { getLevelRef.current = getLevel; }, [getLevel]);

  useEffect(() => { const r = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(r); }, []);

  useEffect(() => {
    if (!ready) return;
    const holder = holderRef.current;
    if (!holder || !hasWebGL() || prefersReducedMotion()) return; // keep the static fallback

    let raf = 0; let disposed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const THREE = await import('three');
        if (disposed) return;
        const w = holder.clientWidth || size;
        const h = holder.clientHeight || size;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100);
        camera.position.set(0, 0, 3.15);
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h);
        renderer.setClearColor(0x000000, 0);
        holder.appendChild(renderer.domElement);
        renderer.domElement.style.display = 'block';

        const geo = new THREE.SphereGeometry(1, 128, 128);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT, fragmentShader: FRAG,
          uniforms: {
            uTime: { value: 0 }, uLevel: { value: 0.3 },
            uColorA: { value: new THREE.Color('#8a7a63') },
            uColorB: { value: new THREE.Color('#f4ecdd') },
            uRim: { value: new THREE.Color('#f4e2bc') },
          },
        });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);

        // Motes — a few faint warm points that parallax with the orb.
        const N = 40; const arr = new Float32Array(N * 3);
        for (let i = 0; i < N; i++) { arr[i*3] = (Math.random()-0.5)*4.2; arr[i*3+1] = (Math.random()-0.5)*3.0; arr[i*3+2] = (Math.random()-0.5)*1.5 - 0.5; }
        const mgeo = new THREE.BufferGeometry();
        mgeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const motes = new THREE.Points(mgeo, new THREE.PointsMaterial({ color: new THREE.Color('#cbb8a0'), size: 0.02, transparent: true, opacity: 0.5, depthWrite: false }));
        scene.add(motes);

        const clock = new THREE.Clock();
        let eased = 0.3;
        const pointer = { x: 0, y: 0 }; const target = { x: 0, y: 0 };
        const onMove = (e: PointerEvent) => {
          const r = holder.getBoundingClientRect();
          target.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
          target.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
        };
        if (parallax) window.addEventListener('pointermove', onMove);

        const osc = (t: number) => 0.36 + 0.30 * (0.5 + 0.5 * Math.sin(t * 0.55)) + 0.12 * Math.sin(t * 0.21 + 1.3);

        const loop = () => {
          const t = clock.getElapsedTime();
          const raw = getLevelRef.current ? getLevelRef.current() : osc(t);
          const targetLvl = Math.max(0, Math.min(1, raw));
          // slow attack / slower release so it swells, never twitches
          const k = targetLvl > eased ? 0.06 : 0.025;
          eased += (targetLvl - eased) * k;
          mat.uniforms.uTime.value = t;
          mat.uniforms.uLevel.value = eased;
          // eased pointer parallax on orb + motes + camera
          pointer.x += (target.x - pointer.x) * 0.045;
          pointer.y += (target.y - pointer.y) * 0.045;
          mesh.rotation.y = pointer.x * 0.35 + t * 0.04;
          mesh.rotation.x = pointer.y * 0.25;
          motes.rotation.y = pointer.x * 0.6;
          motes.rotation.x = pointer.y * 0.4;
          camera.position.x += (pointer.x * 0.25 - camera.position.x) * 0.05;
          camera.position.y += (-pointer.y * 0.18 - camera.position.y) * 0.05;
          camera.lookAt(0, 0, 0);
          renderer.render(scene, camera);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);

        const onResize = () => {
          const nw = holder.clientWidth || size, nh = holder.clientHeight || size;
          camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
        };
        window.addEventListener('resize', onResize);

        cleanup = () => {
          cancelAnimationFrame(raf);
          if (parallax) window.removeEventListener('pointermove', onMove);
          window.removeEventListener('resize', onResize);
          geo.dispose(); mat.dispose(); mgeo.dispose(); (motes.material as { dispose: () => void }).dispose();
          renderer.dispose();
          if (renderer.domElement.parentNode === holder) holder.removeChild(renderer.domElement);
        };
      } catch (err) {
        console.warn('[Orb3D] init failed — static fallback:', err);
      }
    })();

    return () => { disposed = true; if (cleanup) cleanup(); };
  }, [ready, size, parallax]);

  return (
    <div
      ref={holderRef}
      aria-hidden
      className={className}
      style={{ width: size, height: size, borderRadius: '50%', overflow: 'hidden', background: STATIC_BG, boxShadow: '0 26px 50px -20px rgba(60,52,44,.5), 0 0 0 1px rgba(20,16,14,.06)', ...style }}
    />
  );
}
