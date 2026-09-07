'use client';

import type { CSSProperties } from 'react';
import PigmentPlate, { MARCUS_PLATES, type OrbActivity } from './PigmentPlate';

interface Orb3DProps {
  activity?: OrbActivity;
  getLevel?: () => number;
  register?: number;
  size?: number;
  parallax?: boolean;
  className?: string;
  style?: CSSProperties;
  plates?: readonly string[];
}

/** Existing audio-envelope interface; only the visual renderer changes. */
export default function Orb3D({ activity = 'idle', getLevel, register = .2, size = 220, parallax = true, className, style, plates = MARCUS_PLATES }: Orb3DProps) {
  return <div aria-hidden className={className} style={{ position: 'relative', width: size, height: size, flexShrink: 0, ...style }}>
    <PigmentPlate mode="orb" activity={activity} getLevel={getLevel} register={register} parallax={parallax} plates={plates} />
  </div>;
}
