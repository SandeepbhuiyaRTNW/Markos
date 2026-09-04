/**
 * Listening, Response & Conversation Knowledge — deterministic tests (no DB, no LLM, no OpenAI key).
 * Run: npx tsx scripts/test-listening-knowledge.ts
 *
 * ╔═ WHAT THESE TESTS PROVE, AND WHAT THEY CANNOT ══════════════════════════╗
 * Same lens as test-divorce-knowledge.ts: this environment has NO OPENAI_API_KEY,
 * so no test here runs the Composer model.
 *
 *   • Parts A and B are PROMPT-ASSEMBLY tests. They prove the curated listening /
 *     response / conversation content and the guardrails are ASSEMBLED and REACH
 *     the Composer prompt (via applyListeningKnowledge → envelope channels →
 *     buildEnvelopeContextSummary). They do NOT prove the model obeys any of it.
 *
 *   • Part C proves the null path: a turn touching no listening area is left
 *     byte-for-byte alone — the wiring cannot leak into neutral conversation.
 *
 *   • Part D proves the guardrail TEXT exists (inventory), not that the model
 *     follows it.
 *
 *   • Part E proves determinism: same input → identical output, no LLM, no DB.
 *
 * Crisis sentinels are deliberately out of scope here: acute crisis turns
 * early-return before the whisperer stage in orchestrator-v2 and never touch
 * this module.
 */

import {
  detectListeningAreas, buildListeningNote, applyListeningKnowledge,
  RESPONSE_GUARDRAILS, LISTENING_AREAS, LISTENING_LENS, LISTENING_KNOWLEDGE,
} from '../src/lib/agent/listening-knowledge';
import { createStateEnvelope, buildEnvelopeContextSummary } from '../src/lib/agents/state-envelope-utils';

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

function envWith(utterance: string) {
  return createStateEnvelope({ userId: 'u', conversationId: 'c', utterance, conversationHistory: [], userName: null });
}

function main() {
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── A. Listening content ASSEMBLES into the Composer prompt (PROMPT-ASSEMBLY, not model obedience) ──');

  const env1 = envWith('i have to talk to my ex about the kids and i am dreading this conversation');
  const areas1 = detectListeningAreas(env1.utterance);
  assert('dreaded-talk turn detects difficult_conversations', areas1.includes('difficult_conversations'));
  applyListeningKnowledge(env1);
  assert('listening appears in invoked', env1.domain_whisperers.invoked.includes('listening'));
  assert('note lands in context_notes', env1.domain_whisperers.context_notes.some(n => n.includes('LISTENING, RESPONSE & CONVERSATION CRAFT')));
  assert('three-conversations guidance in the note', env1.domain_whisperers.context_notes.some(n => n.includes('what happened') && n.includes('feelings') && n.includes('identity')));
  assert('lens lands in frameworks_applied', env1.domain_whisperers.frameworks_applied.includes('three_conversations'));
  assert('all guardrails ride as landmines', RESPONSE_GUARDRAILS.every(g => env1.domain_whisperers.landmines.includes(g)));
  const ctx1 = buildEnvelopeContextSummary(env1);
  assert('reaches Composer context (WHISPERER INTELLIGENCE + LANDMINES rendered)',
    ctx1.includes('WHISPERER INTELLIGENCE') && ctx1.includes('LANDMINES') && ctx1.includes('LISTENING, RESPONSE & CONVERSATION CRAFT'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── B. Men / help-seeking knowledge (Drive sources) assembles ──');

  const env2 = envWith("honestly i'm fine. i should be able to handle it myself, it's not a big deal");
  applyListeningKnowledge(env2);
  assert('armor turn detects cost_of_talking', env2.domain_whisperers.frameworks_applied.includes('male_disclosure_cost'));
  assert('note carries Addis & Mahalik grounding (self-reliance, not pathology)',
    env2.domain_whisperers.context_notes.some(n => /Addis & Mahalik/.test(n) && /self-reliance/.test(n)));
  assert('note never arms a "you\'re shutting down" attack — guardrail forbids naming reluctance',
    env2.domain_whisperers.landmines.some(l => /Never treat his reluctance/.test(l)));
  assert('note forbids quoting statistics at him',
    env2.domain_whisperers.landmines.some(l => /Never quote statistics/.test(l)));

  const env3 = envWith("i don't need therapy, does talking even help");
  applyListeningKnowledge(env3);
  assert('anti-therapy turn detects help_without_looking_like_help', env3.domain_whisperers.frameworks_applied.includes('low_cost_help_framing'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── B2. Real divorce-conversation terrain (public research) assembles ──');

  const envT = envWith('she filed last week. my divorce lawyer wants all the financial documents by friday. whatever, it is what it is');
  const areasT = detectListeningAreas(envT.utterance);
  assert('divorce opening detects divorce_talk_terrain', areasT.includes('divorce_talk_terrain'));
  applyListeningKnowledge(envT);
  const noteT = envT.domain_whisperers.context_notes.find(n => n.includes('LISTENING, RESPONSE & CONVERSATION CRAFT')) || '';
  assert('terrain note carries the practical-doorway guidance', /HE OPENS WITH THE PRACTICAL/.test(noteT) && /doorway/.test(noteT));
  assert('terrain note carries anger-as-speakable-emotion guidance', /ANGER IS THE SPEAKABLE EMOTION/.test(noteT));
  assert('terrain note cites the research base', /Oliffe/.test(noteT) && /Canfield/.test(noteT));
  assert('dismissal-script guardrail rides as landmine', envT.domain_whisperers.landmines.some(l => /dismissal script/.test(l)));
  assert('terrain lens lands in frameworks_applied', envT.domain_whisperers.frameworks_applied.includes('divorce_talk_terrain'));

  const envS = envWith("papers are signed, it's final. so why is the house so quiet? everyone says i should be relieved");
  applyListeningKnowledge(envS);
  assert('post-decree quiet detects six_divorces_at_once', envS.domain_whisperers.frameworks_applied.includes('bohannan_stations'));
  assert('stations note names community + psychic stations', envS.domain_whisperers.context_notes.some(n => /community divorce/.test(n) && /psychic divorce/.test(n)));
  assert('stations note carries legal-ending-settles-nothing', envS.domain_whisperers.context_notes.some(n => /LEGAL STATION ENDING SETTLES NOTHING/.test(n)));
  assert('stations note carries the confidant-loss grounding', envS.domain_whisperers.context_notes.some(n => /Scourfield/.test(n)));
  assert('no-declared-recovery guardrail rides as landmine', envS.domain_whisperers.landmines.some(l => /Never declare his recovery/.test(l)));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── C. Null path: a neutral turn is left byte-for-byte alone ──');
  assert('empty message triggers no area', detectListeningAreas('').length === 0);
  assert('neutral message triggers no area', detectListeningAreas('yeah work was alright, we shipped the thing on friday').length === 0);
  assert('buildListeningNote returns null for no areas', buildListeningNote([]) === null);
  const env4 = envWith('yeah work was alright, we shipped the thing on friday');
  const before = JSON.stringify(env4.domain_whisperers);
  applyListeningKnowledge(env4);
  assert('applyListeningKnowledge pushes NOTHING on a neutral turn', JSON.stringify(env4.domain_whisperers) === before);
  const ctx4 = buildEnvelopeContextSummary(env4);
  assert('no listening content leaks into the Composer context', !ctx4.includes('LISTENING, RESPONSE & CONVERSATION CRAFT'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── D. Guardrail inventory (the guardrail TEXT exists; not that the model follows it) ──');
  const g = RESPONSE_GUARDRAILS.join(' | ').toLowerCase();
  assert('never interrupt', /never interrupt/.test(g));
  assert('receive before replying', /receive first, then respond/.test(g));
  assert('reflect before advise on loaded disclosure', /reflection or presence, never advice/.test(g));
  assert('one question per turn', /one question per turn/.test(g));
  assert('short turns / hand the floor back', /hand the floor back/.test(g));
  assert('no forcing closure', /do not force closure/.test(g));
  assert('never end on the heaviest note', /heaviest note/.test(g));
  assert('no scripting his side of a fight', /never script his side of the fight/.test(g));
  assert('no naming his reluctance', /never treat his reluctance/.test(g));
  assert('no statistics at him', /never quote statistics/.test(g));
  assert('anger not treated as the whole story', /never treat his anger as the whole story/.test(g));
  assert('no dismissal script', /never hand him the dismissal script/.test(g));
  assert('no declaring his recovery', /never declare his recovery/.test(g));
  assert('crisis sentinel carve-out preserved', /crisis turns are unchanged/.test(g));
  assert('every area has knowledge, a lens, and detection signals',
    LISTENING_AREAS.every(a => LISTENING_KNOWLEDGE.some(k => k.area === a) && typeof LISTENING_LENS[a] === 'string'));

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n── E. Determinism (no LLM, no DB — identical output on repeat) ──');
  const msg = 'slow down, this is too much at once. i have to talk to my brother and i am dreading this conversation';
  const n1 = buildListeningNote(detectListeningAreas(msg));
  const n2 = buildListeningNote(detectListeningAreas(msg));
  assert('identical note on repeated calls', n1 !== null && n1 === n2);
  assert('pacing + difficult_conversations both detected', n1 !== null && n1.includes('[pacing]') && n1.includes('[difficult_conversations]'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
