/**
 * Whisperer Registry — Tier 4 Domain Whisperers
 * Maps arena names to their whisperer runner functions.
 * Used by the orchestrator for dynamic routing.
 */

import type { StateEnvelope } from '../agents/state-envelope';
import type { WhispererResult } from './base-whisperer';
import { runDivorceWhisperer } from './divorce';
import { runGriefWhisperer } from './grief';
import { runFatherhoodWhisperer } from './fatherhood';
import { runLoveWhisperer } from './love';
import { runSexWhisperer } from './sex';
import { runFriendshipWhisperer } from './friendship';
import { runWorkWhisperer } from './work';
import { runMoneyWhisperer } from './money';
import { runHealthWhisperer } from './health';
import { runAddictionWhisperer } from './addiction';
import { runVeteranWhisperer } from './veteran';
import { runMidlifeWhisperer } from './midlife';
import { runFaithCrisisWhisperer } from './faith-crisis';
import { runFatherlessSonWhisperer } from './fatherless-son';

export type WhispererRunner = (env: StateEnvelope) => Promise<WhispererResult>;

/** Complete map of arena name → whisperer function */
export const WHISPERER_REGISTRY: Record<string, WhispererRunner> = {
  divorce: runDivorceWhisperer,
  grief: runGriefWhisperer,
  fatherhood: runFatherhoodWhisperer,
  love: runLoveWhisperer,
  sex: runSexWhisperer,
  friendship: runFriendshipWhisperer,
  work: runWorkWhisperer,
  money: runMoneyWhisperer,
  health: runHealthWhisperer,
  addiction: runAddictionWhisperer,
  veteran: runVeteranWhisperer,
  midlife: runMidlifeWhisperer,
  faith_crisis: runFaithCrisisWhisperer,
  fatherless_son: runFatherlessSonWhisperer,
};

/** Activation threshold for a whisperer (per spec: 0.15 default) */
export const WHISPERER_ACTIVATION_THRESHOLD = 0.15;

export {
  runDivorceWhisperer, runGriefWhisperer, runFatherhoodWhisperer,
  runLoveWhisperer, runSexWhisperer, runFriendshipWhisperer,
  runWorkWhisperer, runMoneyWhisperer, runHealthWhisperer,
  runAddictionWhisperer, runVeteranWhisperer, runMidlifeWhisperer,
  runFaithCrisisWhisperer, runFatherlessSonWhisperer,
};
