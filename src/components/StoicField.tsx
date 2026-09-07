'use client';

import PigmentPlate, { MARCUS_PLATES } from './PigmentPlate';

/** One shared Paper texture shader for intro, landing, auth and session entry. */
export default function StoicField({ register = 0, plates = MARCUS_PLATES }: { register?: number; plates?: readonly string[] }) {
  return <PigmentPlate mode="field" register={register} speed={.14} plates={plates} style={{ zIndex: 0 }} />;
}
