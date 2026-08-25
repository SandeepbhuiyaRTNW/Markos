'use client';

import { GrainGradient } from '@paper-design/shaders-react';

// The Stoic shader field — the intro's ground, extracted so the whole pre-login world (intro,
// landing hero, email/password/code steps, post-signup entry) sits on ONE continuous field and
// never changes worlds. Marcus on campaign: deep sage / weathered bronze / oxblood / aegean
// blue / olive / marble, two drifting GrainGradient layers + a vignette, over a static base
// that also serves as the no-WebGL fallback. Every tone clears L>=0.33 (oxblood #c48f7f floor),
// so dark text over it meets contrast. Renders absolute inset-0; place content above at z>=10.
const FIELD_A = ['#a4b195', '#bda074', '#c48f7f']; // deep sage / weathered bronze / oxblood
const FIELD_B = ['#95a9ae', '#a9a373', '#d8d0be']; // aegean blue / olive / marble
const BASE = '#cec5b2';

export default function StoicField() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', background: BASE }}>
      {/* Static Stoic base — also the no-WebGL fallback */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 120% at 50% 40%, #d8d0be 0%, #bda074 58%, #a9a373 100%)' }} />
      {/* Two drifting Paper Shaders layers */}
      <GrainGradient style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} colors={FIELD_A} colorBack={BASE} shape="blob" softness={0.9} intensity={0.36} noise={0.16} speed={0.12} scale={1.4} fit="cover" />
      <GrainGradient style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5, mixBlendMode: 'soft-light' }} colors={FIELD_B} colorBack="#c9c0ad" shape="blob" softness={0.95} intensity={0.3} noise={0.12} speed={0.08} scale={1.9} fit="cover" />
      {/* Vignette — pulls the edges down (content is inset so text never sits on the darkest ring) */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(125% 125% at 50% 45%, transparent 62%, rgba(58,54,38,0.30) 100%)' }} />
    </div>
  );
}
