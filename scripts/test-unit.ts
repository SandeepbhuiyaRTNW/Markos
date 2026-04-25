/**
 * Unit tests for V2 modules that don't need DB/API.
 * Usage: npx tsx scripts/test-unit.ts
 */

import { detectCrisisType } from '../src/lib/sentinels/crisis';
import { checkBoundary } from '../src/lib/sentinels/boundary';
import { runCulturalContext } from '../src/lib/sentinels/cultural';
import { computeTrust } from '../src/lib/assessment/trust-gauge';
import { mapPhase } from '../src/lib/assessment/phase-mapper';
import { selectWisdomVoices } from '../src/lib/wisdom/council';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';
import { determineCraftDirectives, enforceSocraticDiscipline } from '../src/lib/craft/craft-layer';

let passed = 0, failed = 0;
function assert(name: string, condition: boolean, detail: string = '') {
  if (condition) { passed++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n── TIER 1: Crisis Sentinel ──');
assert('Suicide detected', detectCrisisType("I want to kill myself") === 'suicide');
assert('Violence detected', detectCrisisType("I'm going to kill her") === 'violence_toward_others');
assert('DV perp detected', detectCrisisType("I hit my wife last night") === 'domestic_violence_perpetrating');
assert('DV victim detected', detectCrisisType("She hit me and I'm scared for my life") === 'domestic_violence_victim');
assert('Substance crisis', detectCrisisType("I took too many pills") === 'substance_crisis');
assert('Passive crisis', detectCrisisType("What's the point of anything anymore") === 'passive_crisis');
assert('No crisis on normal', detectCrisisType("I've been thinking about my career") === null);
assert('Better off dead', detectCrisisType("Everyone would be better off without me") === 'suicide');
assert('Can\'t keep going', detectCrisisType("I can't keep going like this") === 'passive_crisis');
assert('Bought a gun', detectCrisisType("I bought a gun yesterday") === 'violence_toward_others');
assert('She threatens', detectCrisisType("She threatens to kill me every night") === 'domestic_violence_victim');
assert('Mixing pills', detectCrisisType("I'm mixing pills and alcohol right now") === 'substance_crisis');

console.log('\n── TIER 1: Boundary Sentinel ──');
const b1 = checkBoundary("It sounds like you're going through a lot.");
assert('Catches "it sounds like"', !b1.passed, b1.violations.join(', '));
const b2 = checkBoundary("You need to set better boundaries and do the work.");
assert('Catches therapy vocab', !b2.passed, b2.violations.join(', '));
const b3 = checkBoundary("What happened when you told her that?");
assert('Clean response passes', b3.passed);
const b4 = checkBoundary("I appreciate you sharing that with me.");
assert('Catches "I appreciate you"', !b4.passed, b4.violations.join(', '));
const b5 = checkBoundary("That's a powerful share, brother.");
assert('Catches "powerful share"', !b5.passed, b5.violations.join(', '));
const b6 = checkBoundary("Your anger makes sense. Where does it live in your body?");
assert('Allows direct question', b6.passed);

console.log('\n── TIER 1: Cultural Context ──');
const c1 = runCulturalContext("I can't do this anymore, everything is falling apart", []);
assert('Raw register', c1.register === 'raw', c1.register);
const c2 = runCulturalContext("yo bro idk what to do ngl", []);
assert('Casual register', c2.register === 'casual', c2.register);
const c3 = runCulturalContext("I've been praying but God doesn't answer", []);
assert('Faith: christian', c3.faith_context === 'christian', String(c3.faith_context));
const c4 = runCulturalContext("I was at the mosque today and felt nothing", []);
assert('Faith: muslim', c4.faith_context === 'muslim', String(c4.faith_context));
const c5 = runCulturalContext("I need to analyze this situation more carefully", []);
assert('Neutral register', c5.register === 'neutral', c5.register);

console.log('\n── TIER 2: Trust Gauge ──');
const t1 = computeTrust("Hey, just found this app", [], 1);
assert('New user low trust', t1.cognitive <= 0.5 && t1.affective <= 0.3, `cog=${t1.cognitive} aff=${t1.affective}`);
const t2 = computeTrust("I've never told anyone this before", [], 3);
assert('Disclosure boosts affective', t2.affective >= 0.3, `aff=${t2.affective}`);
const t3 = computeTrust("This is stupid, you don't understand", [], 5);
const t4 = computeTrust("Good question. I hadn't thought of it that way.", [], 5);
assert('Distrust lowers cognitive', t3.cognitive < t4.cognitive, `distrust=${t3.cognitive} vs clean=${t4.cognitive}`);
const t5 = computeTrust("Nobody knows this but I'm crying right now", [], 8);
assert('Deep disclosure high affective', t5.affective >= 0.4, `aff=${t5.affective}`);

console.log('\n── TIER 2: Phase Mapper ──');
const p1 = mapPhase(1, 2, 'neutral', 0.3, 0.1);
assert('Session 1 → unsilenced', p1.label === 'unsilenced', `${p1.label} (${p1.confidence})`);
const p2 = mapPhase(10, 3, 'opening', 0.6, 0.5);
assert('Session 10 + depth 3 → unleashed', p2.label === 'unleashed', `${p2.label} (${p2.confidence})`);
const p3 = mapPhase(25, 4, 'deepening', 0.8, 0.8);
assert('Session 25 + deep trust → brothered', p3.label === 'brothered', `${p3.label} (${p3.confidence})`);
const p4 = mapPhase(3, 1, 'neutral', 0.3, 0.2);
assert('Session 3, low depth → unsilenced', p4.label === 'unsilenced', `${p4.label} (${p4.confidence})`);

console.log('\n── TIER 3: Wisdom Council ──');
function makeEnv(msg: string, overrides?: Partial<{ arena: string; phase: string; silenceType: string }>) {
  const env = createStateEnvelope({ userId: 'test', conversationId: 'test', utterance: msg, conversationHistory: [] });
  if (overrides?.arena) env.assessment.arena = { weights: { [overrides.arena]: 1 }, primary: overrides.arena };
  if (overrides?.phase) env.assessment.phase = { label: overrides.phase as 'unsilenced'|'unleashed'|'brothered', confidence: 0.8 };
  if (overrides?.silenceType) env.assessment.silence_type = { label: overrides.silenceType as any, evidence: '', confidence: 0.8 };
  return env;
}
const w1 = selectWisdomVoices(makeEnv("Why did he have to die? What's the point?", { arena: 'grief' }));
assert('Grief → existentialist', w1.invoked.includes('existentialist'), w1.invoked.join(', '));
const w2 = selectWisdomVoices(makeEnv("She always does this. Every single time. She never changes.", { phase: 'unleashed' }));
assert('Loops → socratic', w2.invoked.includes('socratic'), w2.invoked.join(', '));
const w3 = selectWisdomVoices(makeEnv("What can I actually control in this situation?"));
assert('Agency → stoic', w3.invoked.includes('stoic'), w3.invoked.join(', '));
const w4 = selectWisdomVoices(makeEnv("Is it the right thing to tell her the truth?"));
assert('Ethics → moral_philosophy', w4.invoked.includes('moral_philosophy'), w4.invoked.join(', '));
const w5 = selectWisdomVoices(makeEnv("I can see my growth now", { phase: 'brothered' }));
assert('Brothered + growth → positive_psychology', w5.invoked.includes('positive_psychology'), w5.invoked.join(', '));

console.log('\n── TIER 5: Craft Layer ──');
const env_shame = makeEnv('test');
env_shame.assessment.silence_type = { label: 'shame', evidence: '', confidence: 0.8 };
const cd1 = determineCraftDirectives(env_shame);
assert('Shame → acknowledgment_only', cd1.pacing === 'acknowledgment_only', `form=${cd1.form} pacing=${cd1.pacing}`);
const env_grief = makeEnv('test');
env_grief.assessment.silence_type = { label: 'grief', evidence: '', confidence: 0.8 };
const cd2 = determineCraftDirectives(env_grief);
assert('Grief → reflection', cd2.form === 'reflection', `form=${cd2.form} pacing=${cd2.pacing}`);
const env_avoid = makeEnv('test');
env_avoid.assessment.silence_type = { label: 'avoidance', evidence: '', confidence: 0.8 };
const cd3 = determineCraftDirectives(env_avoid);
assert('Avoidance → question', cd3.form === 'question', `form=${cd3.form} pacing=${cd3.pacing}`);

const multiQ = "That's heavy.\nWhat happened when you told her?\nHow did that make you feel?\nWhat did you do next?";
const stripped = enforceSocraticDiscipline(multiQ, { form: 'question', pacing: 'full', metaphor_hint: null, style_override: null });
const qCount = (stripped.match(/\?/g) || []).length;
assert('Socratic discipline strips to 1 question', qCount === 1, `${qCount} questions remain`);

// ═══════════════════════════
// TIER 2: PERMA Snapshot
// ═══════════════════════════

import { computePERMASnapshot } from '../src/lib/assessment/perma-snapshot';

console.log('\n── TIER 2: PERMA Snapshot ──');

// Divorce arena → Relationships underwater
const perma_divorce = makeEnv("She left me and took everything", { arena: 'divorce' });
perma_divorce.assessment.arena = { weights: { divorce: 1.0 }, primary: 'divorce' };
perma_divorce.sentinels.listener_stack = {
  words: '', emotion: 'sadness', pattern: '', the_man: '', the_silence: '',
  depth_level: 3, depth_opportunity: '', silence_question: '',
  emotional_trajectory: 'deepening', primary_emotion: 'sadness'
};
const pm1 = computePERMASnapshot(perma_divorce);
assert('Divorce → R underwater', pm1.scores.R < pm1.scores.A, `R=${pm1.scores.R} A=${pm1.scores.A}`);

// Work arena → Accomplishment underwater
const perma_work = makeEnv("I got fired and don't know what to do", { arena: 'work' });
perma_work.assessment.arena = { weights: { work: 1.0 }, primary: 'work' };
const pm2 = computePERMASnapshot(perma_work);
assert('Work → A lowest', pm2.scores.A <= pm2.scores.R, `A=${pm2.scores.A} R=${pm2.scores.R}`);

// Friendship arena → R underwater
const perma_friend = makeEnv("I have no friends", { arena: 'friendship' });
perma_friend.assessment.arena = { weights: { friendship: 1.0 }, primary: 'friendship' };
const pm3 = computePERMASnapshot(perma_friend);
assert('Friendship → R lowest', pm3.scores.R <= pm3.scores.M, `R=${pm3.scores.R} M=${pm3.scores.M}`);

// Shame silence → lowers P and A
const perma_shame = makeEnv("test");
perma_shame.assessment.silence_type = { label: 'shame', evidence: '', confidence: 0.8 };
const pm4_base = computePERMASnapshot(makeEnv("test"));
const pm4_shame = computePERMASnapshot(perma_shame);
assert('Shame silence lowers P', pm4_shame.scores.P < pm4_base.scores.P, `shame=${pm4_shame.scores.P} base=${pm4_base.scores.P}`);

// Multi-arena: divorce + grief → both R and P hit
const perma_multi = makeEnv("She left and then my dad died");
perma_multi.assessment.arena = { weights: { divorce: 0.6, grief: 0.4 }, primary: 'divorce' };
const pm5 = computePERMASnapshot(perma_multi);
assert('Multi-arena lowers both R and P', pm5.scores.R < 0.5 && pm5.scores.P < 0.5, `R=${pm5.scores.R} P=${pm5.scores.P}`);

// No arena → neutral scores (all ~0.6)
const perma_neutral = makeEnv("Just checking in");
const pm6 = computePERMASnapshot(perma_neutral);
assert('No arena → neutral scores', pm6.underwater_domain === null, `underwater=${pm6.underwater_domain} scores=P:${pm6.scores.P}`);

// ═══════════════════════════
// TIER 4: Whisperer Registry
// ═══════════════════════════

import { WHISPERER_REGISTRY, WHISPERER_ACTIVATION_THRESHOLD } from '../src/lib/whisperers';

console.log('\n── TIER 4: Whisperer Registry ──');

const expectedArenas = [
  'divorce', 'grief', 'fatherhood', 'love', 'sex', 'friendship',
  'work', 'money', 'health', 'addiction', 'veteran', 'midlife',
  'faith_crisis', 'fatherless_son',
];

assert('Registry has 14 whisperers', Object.keys(WHISPERER_REGISTRY).length === 14, `count=${Object.keys(WHISPERER_REGISTRY).length}`);

for (const arena of expectedArenas) {
  assert(`Registry has ${arena}`, typeof WHISPERER_REGISTRY[arena] === 'function');
}

assert('Activation threshold is 0.15', WHISPERER_ACTIVATION_THRESHOLD === 0.15, `threshold=${WHISPERER_ACTIVATION_THRESHOLD}`);

// ═══════════════════════════
// TIER 4: Whisperer Routing in Orchestrator
// ═══════════════════════════

console.log('\n── TIER 4: Whisperer Routing Logic ──');

// Simulate the routing logic from orchestrator-v2
function simulateWhispererRouting(arenaWeights: Record<string, number>): string[] {
  return Object.entries(arenaWeights)
    .filter(([, weight]) => weight >= WHISPERER_ACTIVATION_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([arena]) => WHISPERER_REGISTRY[arena])
    .map(([arena]) => arena);
}

const route1 = simulateWhispererRouting({ divorce: 0.8, love: 0.3, money: 0.1 });
assert('Route: divorce + love (money below threshold)', route1.length === 2 && route1.includes('divorce') && route1.includes('love'), route1.join(', '));

const route2 = simulateWhispererRouting({ grief: 0.6, fatherhood: 0.4, midlife: 0.3, work: 0.2 });
assert('Route: caps at 3 whisperers', route2.length === 3, route2.join(', '));

const route3 = simulateWhispererRouting({ work: 0.05 });
assert('Route: nothing below threshold', route3.length === 0, `count=${route3.length}`);

const route4 = simulateWhispererRouting({ veteran: 1.0 });
assert('Route: single arena veteran', route4.length === 1 && route4[0] === 'veteran', route4.join(', '));

const route5 = simulateWhispererRouting({ faith_crisis: 0.5, fatherless_son: 0.3 });
assert('Route: faith_crisis + fatherless_son', route5.length === 2, route5.join(', '));

// ═══════════════════════════
// TIER 4: Fatherless Son Trust Threshold
// ═══════════════════════════

console.log('\n── TIER 4: Fatherless Son Trust Threshold ──');

// The fatherless-son whisperer has a trust threshold of 8 sessions
// unless the man explicitly names it
const fs_low_sessions = createStateEnvelope({ userId: 'test', conversationId: 'test', utterance: 'I feel lost', conversationHistory: [] });
fs_low_sessions.sentinels.memory.session_count = 3;
// We can't call runFatherlessSonWhisperer directly (needs DB), but we can test the threshold logic
function fatherlessSonMeetsThreshold(env: ReturnType<typeof createStateEnvelope>): boolean {
  const sessionCount = env.sentinels.memory.session_count;
  if (sessionCount >= 8) return true;
  const msg = env.utterance.toLowerCase();
  return /\b(my (dad|father)|grew up without|fatherless|absent father|never knew my|dad.*left|father.*abandon)\b/i.test(msg);
}

assert('3 sessions, generic msg → blocked', !fatherlessSonMeetsThreshold(fs_low_sessions));

const fs_explicit = createStateEnvelope({ userId: 'test', conversationId: 'test', utterance: 'My dad left when I was five', conversationHistory: [] });
fs_explicit.sentinels.memory.session_count = 2;
assert('2 sessions, explicit mention → allowed', fatherlessSonMeetsThreshold(fs_explicit));

const fs_deep = createStateEnvelope({ userId: 'test', conversationId: 'test', utterance: 'I feel lost', conversationHistory: [] });
fs_deep.sentinels.memory.session_count = 10;
assert('10 sessions, generic msg → allowed', fatherlessSonMeetsThreshold(fs_deep));

const fs_absent = createStateEnvelope({ userId: 'test', conversationId: 'test', utterance: 'I grew up without a dad', conversationHistory: [] });
fs_absent.sentinels.memory.session_count = 1;
assert('1 session, "grew up without" → allowed', fatherlessSonMeetsThreshold(fs_absent));

// ═══════════════════════════
// SUMMARY
// ═══════════════════════════
console.log('\n' + '═'.repeat(50));
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);

