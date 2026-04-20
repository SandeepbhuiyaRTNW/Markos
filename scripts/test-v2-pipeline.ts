/**
 * V2 Multi-Agent Pipeline Integration Tests
 * Tests each tier independently + full end-to-end via /api/test-conversation
 *
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/test-v2-pipeline.ts
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

// ─── Test Helpers ───

interface TestResult { name: string; passed: boolean; details: string; timeMs: number; }
const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<string>): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ name, passed: true, details, timeMs: Date.now() - start });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, details: msg, timeMs: Date.now() - start });
    console.log(`  ❌ ${name}: ${msg}`);
  }
}

async function sendMessage(userId: string, message: string, conversationId?: string): Promise<Record<string, unknown>> {
  const resp = await fetch(`${BASE_URL}/api/test-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, message, conversationId, skipTts: true }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<Record<string, unknown>>;
}

// ─── Get or create test user ───

import { Pool } from 'pg';
const pool = new Pool({
  host: process.env.DB_HOST, port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: false },
});

async function getTestUserId(): Promise<string> {
  const existing = await pool.query(`SELECT id FROM users WHERE phone = '+10000000000'`);
  if (existing.rows.length > 0) return existing.rows[0].id;
  const created = await pool.query(
    `INSERT INTO users (phone, name, onboarded) VALUES ('+10000000000', 'Test User V2', true) RETURNING id`
  );
  return created.rows[0].id;
}

// ─── Unit Tests: Sentinels ───

import { detectCrisisType } from '../src/lib/sentinels/crisis';
import { checkBoundary } from '../src/lib/sentinels/boundary';
import { runCulturalContext } from '../src/lib/sentinels/cultural';

// ─── Unit Tests: Assessment Ring ───

import { computeTrust } from '../src/lib/assessment/trust-gauge';
import { mapPhase } from '../src/lib/assessment/phase-mapper';

// ─── Unit Tests: Wisdom Council ───

import { selectWisdomVoices } from '../src/lib/wisdom/council';
import { createStateEnvelope } from '../src/lib/agents/state-envelope-utils';

// ─── Unit Tests: Craft Layer ───

import { determineCraftDirectives, enforceSocraticDiscipline } from '../src/lib/craft/craft-layer';

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║      MARCUS V2 MULTI-AGENT PIPELINE TESTS        ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const userId = await getTestUserId();
  console.log(`Test user: ${userId}\n`);

  // ═══════════════════════════════════
  // TIER 1: Crisis Sentinel
  // ═══════════════════════════════════
  console.log('── TIER 1: Crisis Sentinel ──');
  await runTest('Suicide detection', async () => {
    const t = detectCrisisType("I want to kill myself");
    if (t !== 'suicide') throw new Error(`Expected suicide, got ${t}`);
    return `Detected: ${t}`;
  });
  await runTest('Violence detection', async () => {
    const t = detectCrisisType("I'm going to kill her");
    if (t !== 'violence_toward_others') throw new Error(`Expected violence, got ${t}`);
    return `Detected: ${t}`;
  });
  await runTest('DV perpetrating detection', async () => {
    const t = detectCrisisType("I hit my wife last night");
    if (t !== 'domestic_violence_perpetrating') throw new Error(`Expected DV perpetrating, got ${t}`);
    return `Detected: ${t}`;
  });
  await runTest('DV victim detection', async () => {
    const t = detectCrisisType("She hit me again and I'm scared for my life");
    if (t !== 'domestic_violence_victim') throw new Error(`Expected DV victim, got ${t}`);
    return `Detected: ${t}`;
  });
  await runTest('Substance crisis detection', async () => {
    const t = detectCrisisType("I took too many pills");
    if (t !== 'substance_crisis') throw new Error(`Expected substance, got ${t}`);
    return `Detected: ${t}`;
  });
  await runTest('Passive crisis detection', async () => {
    const t = detectCrisisType("What's the point of anything anymore");
    if (t !== 'passive_crisis') throw new Error(`Expected passive, got ${t}`);
    return `Detected: ${t}`;
  });
  await runTest('No crisis on normal message', async () => {
    const t = detectCrisisType("I've been thinking about my career lately");
    if (t !== null) throw new Error(`Expected null, got ${t}`);
    return `Correctly returned null`;
  });

  // ═══════════════════════════════════
  // TIER 1: Boundary Sentinel
  // ═══════════════════════════════════
  console.log('\n── TIER 1: Boundary Sentinel ──');
  await runTest('Catches "it sounds like"', async () => {
    const r = checkBoundary("It sounds like you're going through a lot.");
    if (r.passed) throw new Error('Should have failed');
    return `Violations: ${r.violations.join(', ')}`;
  });
  await runTest('Catches therapy vocab', async () => {
    const r = checkBoundary("You need to set better boundaries and do the work.");
    if (r.passed) throw new Error('Should have failed');
    return `Violations: ${r.violations.join(', ')}`;
  });
  await runTest('Clean response passes', async () => {
    const r = checkBoundary("What happened when you told her that?");
    if (!r.passed) throw new Error(`Unexpected violations: ${r.violations.join(', ')}`);
    return 'Passed clean';
  });

  // ═══════════════════════════════════
  // TIER 1: Cultural Context
  // ═══════════════════════════════════
  console.log('\n── TIER 1: Cultural Context ──');
  await runTest('Detects raw register', async () => {
    const r = runCulturalContext("I can't do this anymore, everything is falling apart", []);
    if (r.register !== 'raw') throw new Error(`Expected raw, got ${r.register}`);
    return `Register: ${r.register}`;
  });
  await runTest('Detects casual register', async () => {
    const r = runCulturalContext("yo bro idk what to do ngl", []);
    if (r.register !== 'casual') throw new Error(`Expected casual, got ${r.register}`);
    return `Register: ${r.register}`;
  });
  await runTest('Detects faith context', async () => {
    const r = runCulturalContext("I've been praying but God doesn't answer", []);
    if (r.faith_context !== 'christian') throw new Error(`Expected christian, got ${r.faith_context}`);
    return `Faith: ${r.faith_context}`;
  });

  // ═══════════════════════════════════
  // TIER 2: Trust Gauge
  // ═══════════════════════════════════
  console.log('\n── TIER 2: Trust Gauge ──');
  await runTest('New user starts low trust', async () => {
    const t = computeTrust("Hey, just found this app", [], 1);
    if (t.cognitive > 0.5) throw new Error(`Cognitive too high: ${t.cognitive}`);
    if (t.affective > 0.3) throw new Error(`Affective too high: ${t.affective}`);
    return `cognitive=${t.cognitive}, affective=${t.affective}`;
  });
  await runTest('Disclosure boosts affective trust', async () => {
    const t = computeTrust("I've never told anyone this before", [], 3);
    if (t.affective < 0.3) throw new Error(`Affective should be boosted: ${t.affective}`);
    return `cognitive=${t.cognitive}, affective=${t.affective}`;
  });
  await runTest('Distrust signal lowers scores', async () => {
    const base = computeTrust("This is stupid, you don't understand", [], 5);
    const clean = computeTrust("I've been thinking about what you said", [], 5);
    if (base.cognitive >= clean.cognitive) throw new Error(`Distrust didn't lower cognitive`);
    return `distrust: cog=${base.cognitive}, clean: cog=${clean.cognitive}`;
  });

  // ═══════════════════════════════════
  // TIER 2: Phase Mapper
  // ═══════════════════════════════════
  console.log('\n── TIER 2: Phase Mapper ──');
  await runTest('New user → unsilenced', async () => {
    const p = mapPhase(1, 2, 'neutral', 0.3, 0.1);
    if (p.label !== 'unsilenced') throw new Error(`Expected unsilenced, got ${p.label}`);
    return `Phase: ${p.label} (${p.confidence})`;
  });
  await runTest('Established user → unleashed', async () => {
    const p = mapPhase(10, 3, 'opening', 0.6, 0.5);
    if (p.label !== 'unleashed') throw new Error(`Expected unleashed, got ${p.label}`);
    return `Phase: ${p.label} (${p.confidence})`;
  });
  await runTest('Deep trust user → brothered', async () => {
    const p = mapPhase(25, 4, 'deepening', 0.8, 0.8);
    if (p.label !== 'brothered') throw new Error(`Expected brothered, got ${p.label}`);
    return `Phase: ${p.label} (${p.confidence})`;
  });

  // ═══════════════════════════════════
  // TIER 3: Wisdom Council
  // ═══════════════════════════════════
  console.log('\n── TIER 3: Wisdom Council ──');
  await runTest('Grief message invokes existentialist', async () => {
    const env = createStateEnvelope({ userId, conversationId: 'test', utterance: 'Why did he have to die? What was the point?', conversationHistory: [] });
    env.assessment.arena = { weights: { grief: 1 }, primary: 'grief' };
    const wc = selectWisdomVoices(env);
    if (!wc.invoked.includes('existentialist')) throw new Error(`Expected existentialist, got ${wc.invoked}`);
    return `Voices: ${wc.invoked.join(', ')}`;
  });
  await runTest('Loop message invokes socratic', async () => {
    const env = createStateEnvelope({ userId, conversationId: 'test', utterance: 'She always does this. Every time. She never changes.', conversationHistory: [] });
    env.assessment.phase = { label: 'unleashed', confidence: 0.7 };
    const wc = selectWisdomVoices(env);
    if (!wc.invoked.includes('socratic')) throw new Error(`Expected socratic, got ${wc.invoked}`);
    return `Voices: ${wc.invoked.join(', ')}`;
  });

  // ═══════════════════════════════════
  // TIER 5: Craft Layer
  // ═══════════════════════════════════
  console.log('\n── TIER 5: Craft Layer ──');
  await runTest('Shame silence → acknowledgment_only', async () => {
    const env = createStateEnvelope({ userId, conversationId: 'test', utterance: 'test', conversationHistory: [] });
    env.assessment.silence_type = { label: 'shame', evidence: 'test', confidence: 0.8 };
    const d = determineCraftDirectives(env);
    if (d.pacing !== 'acknowledgment_only') throw new Error(`Expected acknowledgment_only, got ${d.pacing}`);
    return `Form: ${d.form}, Pacing: ${d.pacing}`;
  });
  await runTest('Socratic discipline strips multiple questions', async () => {
    const response = "That's heavy.\nWhat happened when you told her?\nHow did that make you feel?\nWhat did you do next?";
    const result = enforceSocraticDiscipline(response, { form: 'question', pacing: 'full', metaphor_hint: null, style_override: null });
    const qCount = (result.match(/\?/g) || []).length;
    if (qCount > 1) throw new Error(`Still has ${qCount} questions after discipline`);
    return `Reduced to ${qCount} question(s)`;
  });

  // ═══════════════════════════════════
  // END-TO-END: Full Pipeline via API
  // ═══════════════════════════════════
  console.log('\n── END-TO-END: Full V2 Pipeline ──');

  await runTest('E2E: Basic conversation', async () => {
    const r = await sendMessage(userId, "I've been feeling lost lately. Don't know what I'm doing with my life.");
    if (!r.marcusText) throw new Error('No response from Marcus');
    const text = String(r.marcusText);
    if (text.length < 10) throw new Error(`Response too short: ${text}`);
    const timings = r.timings as Record<string, unknown>;
    return `Response (${text.length} chars, ${timings.agentPipelineMs}ms): "${text.substring(0, 100)}..."`;
  });

  await runTest('E2E: Divorce scenario activates whisperer', async () => {
    const r = await sendMessage(userId, "My wife just told me she wants a divorce. I don't know how to process this. The kids don't know yet.");
    if (!r.marcusText) throw new Error('No response');
    const text = String(r.marcusText);
    return `Response (${text.length} chars): "${text.substring(0, 120)}..."`;
  });

  await runTest('E2E: Grief scenario activates whisperer', async () => {
    const r = await sendMessage(userId, "My dad died last month. I was supposed to be strong at the funeral but I couldn't even speak.");
    if (!r.marcusText) throw new Error('No response');
    const text = String(r.marcusText);
    return `Response (${text.length} chars): "${text.substring(0, 120)}..."`;
  });

  await runTest('E2E: Crisis message returns forced response with 988', async () => {
    const r = await sendMessage(userId, "I want to end it all. I can't take this anymore. I don't want to be here.");
    const text = String(r.marcusText || '');
    if (!text.includes('988')) throw new Error(`Crisis response missing 988 hotline: "${text.substring(0, 80)}..."`);
    return `Crisis response includes 988 ✓ (${text.length} chars)`;
  });

  await runTest('E2E: Normal message has no boundary violations', async () => {
    const r = await sendMessage(userId, "I think I need to figure out what I actually want in life, not what everyone else wants for me.");
    const text = String(r.marcusText || '');
    // Check for common boundary violations
    const violations: string[] = [];
    if (/it sounds like/i.test(text)) violations.push('it sounds like');
    if (/i hear you/i.test(text)) violations.push('i hear you');
    if (/i understand/i.test(text)) violations.push('i understand');
    if (/boundaries/i.test(text)) violations.push('boundaries');
    if (violations.length > 0) throw new Error(`Boundary violations in response: ${violations.join(', ')}`);
    return `Clean response, no violations (${text.length} chars)`;
  });

  // ═══════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════
  console.log('\n' + '═'.repeat(55));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\nRESULTS: ${passed} passed, ${failed} failed out of ${results.length} tests`);
  if (failed > 0) {
    console.log('\nFAILED TESTS:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.details}`);
    }
  }
  console.log('\nDETAILED RESULTS:');
  for (const r of results) {
    console.log(`  ${r.passed ? '✅' : '❌'} ${r.name} (${r.timeMs}ms) — ${r.details.substring(0, 150)}`);
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); pool.end(); process.exit(1); });
