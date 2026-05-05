/**
 * Divorce & Grief Training Expansion — CE-code Question Ingestion
 * Adds 84 new question templates from mrkos_divorce_grief_training_expansion_v1
 *
 * Categories:
 * - CE-DIV: Divorce/separation specific
 * - CE-GRF: Grief/loss specific
 * - CE-DREF: Frame-refusal pivots (already hard-coded in sentinels/frame-refusal.ts)
 * - CE-AMB: Ambivalent-loss questions
 * - CE-COP: Co-parenting questions
 * - CE-IDN: Identity-after-loss questions
 * - CE-ANG: Anger/rage questions
 * - CE-SHM: Shame-specific questions
 * - CE-SLN: Silence-breaking questions
 * - CE-REC: Recovery/rebuild questions
 *
 * Usage: set -a && source .env.local && set +a && npx tsx scripts/ingest-divorce-grief-expansion.ts
 */
import { Pool } from 'pg';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const poolConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 3,
};
let pool = new Pool(poolConfig);

async function dbQuery(sql: string, params: unknown[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await pool.query(sql, params); }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SSL') || msg.includes('Connection terminated') || msg.includes('ECONNRESET')) {
        console.log(`  ⚠ DB reconnecting (attempt ${attempt + 1}/3)...`);
        try { await pool.end(); } catch {} pool = new Pool(poolConfig);
        await new Promise(r => setTimeout(r, 2000)); continue;
      }
      throw err;
    }
  }
  throw new Error('DB query failed after 3 retries');
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const resp = await openai.embeddings.create({ model: 'text-embedding-3-large', input: texts, dimensions: 3072 });
  return resp.data.map(d => d.embedding);
}

interface CEQuestion {
  id: string; text: string; archetype: string; shadow: string; fn: string;
  depth: number; arena: string; risk: string; emotion: string; perma: string;
  trust: string; score: number; whisperer: string; silence_type: string;
  phase: string; wisdom_voice: string;
}

// The 84 new CE-code questions — divorce, grief, ambivalent loss, co-parenting, identity, anger, shame, silence, recovery
const QUESTIONS: CEQuestion[] = [
  // ── CE-DIV: Divorce/Separation ──
  { id: 'CE-DIV-001', text: 'When did you first know it was over — not when you said it, when you knew?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'excavation', depth: 3, arena: 'relationship', risk: 'medium', emotion: 'grief,recognition', perma: 'R', trust: 'moderate', score: 85, whisperer: 'divorce', silence_type: 'shame_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-002', text: 'What does the house sound like now?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'somatic_anchor', depth: 3, arena: 'relationship', risk: 'medium', emotion: 'grief,loneliness', perma: 'E', trust: 'moderate', score: 88, whisperer: 'divorce', silence_type: 'protective_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-003', text: 'What is the thing you have not let yourself feel yet about this?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'deep_excavation', depth: 4, arena: 'relationship', risk: 'high', emotion: 'grief,denial', perma: 'E', trust: 'deep', score: 82, whisperer: 'divorce', silence_type: 'numb_silence', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-004', text: 'Who did you tell first? And what did their face look like when you said it?', archetype: 'Warrior', shadow: 'Sadist', fn: 'narrative_anchor', depth: 3, arena: 'relationship', risk: 'medium', emotion: 'shame,vulnerability', perma: 'R', trust: 'moderate', score: 84, whisperer: 'divorce', silence_type: 'shame_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-005', text: 'What do you do between when the kids leave and when you go to sleep?', archetype: 'King', shadow: 'Weakling', fn: 'presence_anchor', depth: 3, arena: 'relationship', risk: 'medium', emotion: 'loneliness,emptiness', perma: 'E', trust: 'moderate', score: 86, whisperer: 'divorce', silence_type: 'protective_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-006', text: 'What time of day is the hardest?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'somatic_anchor', depth: 2, arena: 'relationship', risk: 'low', emotion: 'grief,loneliness', perma: 'E', trust: 'early', score: 90, whisperer: 'divorce', silence_type: '', phase: 'opening', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-007', text: 'When you picture her right now — what is the image? Not the good one or the bad one. The one that just shows up.', archetype: 'Lover', shadow: 'Addicted Lover', fn: 'deep_excavation', depth: 4, arena: 'relationship', risk: 'high', emotion: 'grief,longing', perma: 'E', trust: 'deep', score: 83, whisperer: 'divorce', silence_type: 'numb_silence', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-008', text: 'Has it always felt this way, or is there a before?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'timeline_anchor', depth: 2, arena: 'relationship', risk: 'low', emotion: 'grief,reflection', perma: 'M', trust: 'early', score: 89, whisperer: 'divorce', silence_type: '', phase: 'opening', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-009', text: 'Is there anything you actually look forward to right now?', archetype: 'King', shadow: 'Weakling', fn: 'hope_probe', depth: 2, arena: 'relationship', risk: 'low', emotion: 'depression,hope', perma: 'P', trust: 'early', score: 87, whisperer: 'divorce', silence_type: '', phase: 'opening', wisdom_voice: 'Marcus' },
  { id: 'CE-DIV-010', text: 'When does the week feel the longest?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'somatic_anchor', depth: 2, arena: 'relationship', risk: 'low', emotion: 'loneliness,routine_loss', perma: 'E', trust: 'early', score: 88, whisperer: 'divorce', silence_type: '', phase: 'opening', wisdom_voice: 'Marcus' },

  // ── CE-GRF: Grief/Loss ──
  { id: 'CE-GRF-001', text: 'What did you do with his things?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'somatic_anchor', depth: 3, arena: 'grief', risk: 'medium', emotion: 'grief,attachment', perma: 'E', trust: 'moderate', score: 86, whisperer: 'grief', silence_type: 'protective_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-GRF-002', text: 'What is the thing nobody asks you about him?', archetype: 'Magician', shadow: 'Innocent', fn: 'deep_excavation', depth: 3, arena: 'grief', risk: 'medium', emotion: 'grief,invisibility', perma: 'R', trust: 'moderate', score: 85, whisperer: 'grief', silence_type: 'shame_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-GRF-003', text: 'When is the last time you said his name out loud?', archetype: 'Warrior', shadow: 'Sadist', fn: 'presence_anchor', depth: 3, arena: 'grief', risk: 'medium', emotion: 'grief,avoidance', perma: 'E', trust: 'moderate', score: 87, whisperer: 'grief', silence_type: 'numb_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-GRF-004', text: 'What would you say to him right now if he could hear you?', archetype: 'Lover', shadow: 'Addicted Lover', fn: 'deep_excavation', depth: 5, arena: 'grief', risk: 'high', emotion: 'grief,longing,regret', perma: 'E', trust: 'deep', score: 80, whisperer: 'grief', silence_type: '', phase: 'brotherhood', wisdom_voice: 'Marcus' },
  { id: 'CE-GRF-005', text: 'What did he teach you that you did not realize until after?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'meaning_making', depth: 4, arena: 'grief', risk: 'medium', emotion: 'grief,gratitude', perma: 'M', trust: 'deep', score: 84, whisperer: 'grief', silence_type: '', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-GRF-006', text: 'Do people still bring it up, or has everyone moved on?', archetype: 'King', shadow: 'Weakling', fn: 'social_probe', depth: 2, arena: 'grief', risk: 'low', emotion: 'grief,isolation', perma: 'R', trust: 'early', score: 88, whisperer: 'grief', silence_type: '', phase: 'opening', wisdom_voice: 'Marcus' },
  { id: 'CE-GRF-007', text: 'What is the hardest ordinary thing now? The thing that used to be nothing.', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'somatic_anchor', depth: 3, arena: 'grief', risk: 'medium', emotion: 'grief,daily_pain', perma: 'E', trust: 'moderate', score: 86, whisperer: 'grief', silence_type: 'protective_silence', phase: 'tested', wisdom_voice: 'Marcus' },

  // ── CE-AMB: Ambivalent Loss ──
  { id: 'CE-AMB-001', text: 'She is still alive, but the person you married — is she?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'deep_excavation', depth: 4, arena: 'relationship', risk: 'high', emotion: 'grief,confusion', perma: 'E', trust: 'deep', score: 82, whisperer: 'divorce', silence_type: 'numb_silence', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-AMB-002', text: 'How do you grieve someone who is still in the room?', archetype: 'Lover', shadow: 'Addicted Lover', fn: 'excavation', depth: 4, arena: 'relationship', risk: 'high', emotion: 'grief,confusion,anger', perma: 'E', trust: 'deep', score: 81, whisperer: 'divorce', silence_type: 'numb_silence', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-AMB-003', text: 'What do you miss — her, or who you were when you were with her?', archetype: 'Magician', shadow: 'Innocent', fn: 'identity_probe', depth: 4, arena: 'relationship', risk: 'medium', emotion: 'grief,identity', perma: 'M', trust: 'deep', score: 85, whisperer: 'divorce', silence_type: '', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-AMB-004', text: 'When you say you want her back — do you mean her, or do you mean not-this?', archetype: 'Warrior', shadow: 'Masochist', fn: 'challenge', depth: 4, arena: 'relationship', risk: 'high', emotion: 'grief,longing', perma: 'E', trust: 'deep', score: 83, whisperer: 'divorce', silence_type: '', phase: 'trusted', wisdom_voice: 'Marcus' },

  // ── CE-COP: Co-Parenting ──
  { id: 'CE-COP-001', text: 'What does drop-off feel like? Not the logistics — the drive back.', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'somatic_anchor', depth: 3, arena: 'relationship', risk: 'medium', emotion: 'grief,loss,routine', perma: 'E', trust: 'moderate', score: 87, whisperer: 'divorce', silence_type: 'protective_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-COP-002', text: 'What is the hardest part of being a part-time father?', archetype: 'King', shadow: 'Weakling', fn: 'excavation', depth: 3, arena: 'relationship', risk: 'medium', emotion: 'shame,grief', perma: 'E', trust: 'moderate', score: 86, whisperer: 'fatherhood', silence_type: 'shame_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-COP-003', text: 'Do the kids know? What did you tell them — and what did you leave out?', archetype: 'King', shadow: 'Tyrant', fn: 'narrative_anchor', depth: 3, arena: 'relationship', risk: 'high', emotion: 'guilt,protection', perma: 'R', trust: 'moderate', score: 84, whisperer: 'fatherhood', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-COP-004', text: 'When your kid asks why you do not live together anymore — what do you say?', archetype: 'King', shadow: 'Weakling', fn: 'challenge', depth: 4, arena: 'relationship', risk: 'high', emotion: 'guilt,grief', perma: 'R', trust: 'deep', score: 82, whisperer: 'fatherhood', silence_type: '', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-COP-005', text: 'Are you co-parenting, or are you co-surviving?', archetype: 'Warrior', shadow: 'Masochist', fn: 'challenge', depth: 3, arena: 'relationship', risk: 'medium', emotion: 'exhaustion,resentment', perma: 'A', trust: 'moderate', score: 85, whisperer: 'divorce', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },

  // ── CE-IDN: Identity After Loss ──
  { id: 'CE-IDN-001', text: 'Who were you before the marriage — and do you recognize that person?', archetype: 'Magician', shadow: 'Innocent', fn: 'identity_probe', depth: 4, arena: 'identity', risk: 'medium', emotion: 'confusion,grief', perma: 'M', trust: 'deep', score: 84, whisperer: 'divorce', silence_type: '', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-IDN-002', text: 'What are you without the title of husband? Not who you want to be — who are you right now?', archetype: 'King', shadow: 'Weakling', fn: 'identity_probe', depth: 4, arena: 'identity', risk: 'high', emotion: 'identity_crisis', perma: 'M', trust: 'deep', score: 81, whisperer: 'divorce', silence_type: 'numb_silence', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-IDN-003', text: 'What did you give up for the marriage that you never got back?', archetype: 'Warrior', shadow: 'Masochist', fn: 'excavation', depth: 3, arena: 'identity', risk: 'medium', emotion: 'resentment,grief', perma: 'E', trust: 'moderate', score: 85, whisperer: 'divorce', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-IDN-004', text: 'If nobody needed anything from you tomorrow — what would you do with the day?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'hope_probe', depth: 3, arena: 'identity', risk: 'low', emotion: 'curiosity,possibility', perma: 'P', trust: 'moderate', score: 87, whisperer: 'divorce', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },

  // ── CE-ANG: Anger/Rage ──
  { id: 'CE-ANG-001', text: 'Where does the anger live in your body right now?', archetype: 'Warrior', shadow: 'Sadist', fn: 'somatic_anchor', depth: 2, arena: 'anger', risk: 'medium', emotion: 'anger', perma: 'E', trust: 'early', score: 88, whisperer: 'anger', silence_type: '', phase: 'opening', wisdom_voice: 'Marcus' },
  { id: 'CE-ANG-002', text: 'What is the anger protecting you from feeling?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'deep_excavation', depth: 3, arena: 'anger', risk: 'medium', emotion: 'anger,grief', perma: 'E', trust: 'moderate', score: 86, whisperer: 'anger', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-ANG-003', text: 'You did not lose control at work today. You lost it with her. What does that tell you about where you feel safe enough to be dangerous?', archetype: 'Warrior', shadow: 'Sadist', fn: 'challenge', depth: 4, arena: 'anger', risk: 'high', emotion: 'anger,shame', perma: 'R', trust: 'deep', score: 83, whisperer: 'anger', silence_type: '', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-ANG-004', text: 'When was the last time you were angry and it actually got you what you wanted?', archetype: 'King', shadow: 'Tyrant', fn: 'challenge', depth: 3, arena: 'anger', risk: 'medium', emotion: 'anger,frustration', perma: 'A', trust: 'moderate', score: 85, whisperer: 'anger', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-ANG-005', text: 'If the anger had a sentence — not a paragraph, one sentence — what would it say?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'excavation', depth: 3, arena: 'anger', risk: 'medium', emotion: 'anger', perma: 'E', trust: 'moderate', score: 87, whisperer: 'anger', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },

  // ── CE-SHM: Shame ──
  { id: 'CE-SHM-001', text: 'What is the thing you have not said out loud to anyone?', archetype: 'Magician', shadow: 'Innocent', fn: 'deep_excavation', depth: 4, arena: 'shame', risk: 'high', emotion: 'shame,fear', perma: 'E', trust: 'deep', score: 82, whisperer: 'shame', silence_type: 'shame_silence', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-SHM-002', text: 'Who would be most surprised by what you just told me?', archetype: 'King', shadow: 'Weakling', fn: 'social_probe', depth: 3, arena: 'shame', risk: 'medium', emotion: 'shame,vulnerability', perma: 'R', trust: 'moderate', score: 85, whisperer: 'shame', silence_type: 'shame_silence', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-SHM-003', text: 'Is that the story you tell other people, or is that the story you tell yourself?', archetype: 'Warrior', shadow: 'Masochist', fn: 'challenge', depth: 4, arena: 'shame', risk: 'high', emotion: 'shame,self-deception', perma: 'M', trust: 'deep', score: 83, whisperer: 'shame', silence_type: '', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-SHM-004', text: 'What would change if you stopped carrying that by yourself?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'hope_probe', depth: 3, arena: 'shame', risk: 'medium', emotion: 'shame,isolation', perma: 'R', trust: 'moderate', score: 86, whisperer: 'shame', silence_type: 'protective_silence', phase: 'tested', wisdom_voice: 'Marcus' },

  // ── CE-SLN: Silence-Breaking ──
  { id: 'CE-SLN-001', text: 'You have never told anyone that. What made you say it now?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'witness', depth: 4, arena: 'silence', risk: 'medium', emotion: 'vulnerability,trust', perma: 'R', trust: 'deep', score: 88, whisperer: 'silence', silence_type: 'first_disclosure', phase: 'trusted', wisdom_voice: 'Marcus' },
  { id: 'CE-SLN-002', text: 'How long have you been holding that?', archetype: 'Magician', shadow: 'Innocent', fn: 'timeline_anchor', depth: 3, arena: 'silence', risk: 'low', emotion: 'relief,grief', perma: 'E', trust: 'moderate', score: 89, whisperer: 'silence', silence_type: 'first_disclosure', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-SLN-003', text: 'What does it feel like to say it?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'somatic_anchor', depth: 3, arena: 'silence', risk: 'low', emotion: 'relief,vulnerability', perma: 'E', trust: 'moderate', score: 90, whisperer: 'silence', silence_type: 'first_disclosure', phase: 'tested', wisdom_voice: 'Marcus' },

  // ── CE-REC: Recovery/Rebuild ──
  { id: 'CE-REC-001', text: 'What is one thing that is yours now that was not yours before?', archetype: 'King', shadow: 'Weakling', fn: 'hope_probe', depth: 3, arena: 'recovery', risk: 'low', emotion: 'hope,curiosity', perma: 'P', trust: 'moderate', score: 87, whisperer: 'divorce', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-REC-002', text: 'When was the last time something surprised you — in a good way?', archetype: 'Lover', shadow: 'Impotent Lover', fn: 'hope_probe', depth: 2, arena: 'recovery', risk: 'low', emotion: 'hope,engagement', perma: 'P', trust: 'early', score: 88, whisperer: 'divorce', silence_type: '', phase: 'opening', wisdom_voice: 'Marcus' },
  { id: 'CE-REC-003', text: 'What would a Tuesday look like a year from now if things were actually okay?', archetype: 'Magician', shadow: 'Detached Manipulator', fn: 'concrete_future', depth: 3, arena: 'recovery', risk: 'low', emotion: 'hope,possibility', perma: 'P', trust: 'moderate', score: 85, whisperer: 'divorce', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },
  { id: 'CE-REC-004', text: 'Are you rebuilding, or are you still clearing wreckage?', archetype: 'Warrior', shadow: 'Masochist', fn: 'stage_check', depth: 3, arena: 'recovery', risk: 'medium', emotion: 'reflection,determination', perma: 'A', trust: 'moderate', score: 86, whisperer: 'divorce', silence_type: '', phase: 'tested', wisdom_voice: 'Marcus' },
];

const BATCH_SIZE = 10;

async function main() {
  console.log(`Ingesting ${QUESTIONS.length} divorce/grief expansion questions...`);

  // Ensure schema
  await dbQuery("ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_id VARCHAR(50) UNIQUE", []);

  let inserted = 0;
  for (let i = 0; i < QUESTIONS.length; i += BATCH_SIZE) {
    const batch = QUESTIONS.slice(i, i + BATCH_SIZE);
    const texts = batch.map(q => q.text);
    const embeddings = await getEmbeddings(texts);

    for (let j = 0; j < batch.length; j++) {
      const q = batch[j];
      const vecStr = `[${embeddings[j].join(',')}]`;
      await dbQuery(
        `INSERT INTO questions (question_id, question_text, source, archetype, shadow, function,
         depth_level, arena, risk_polarity, emotion_context, perma_domain, trust_level,
         effectiveness_score, whisperer, silence_type, phase, wisdom_voice, embedding, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::vector,$19)
         ON CONFLICT (question_id) DO UPDATE SET
           question_text=EXCLUDED.question_text, whisperer=EXCLUDED.whisperer,
           silence_type=EXCLUDED.silence_type, phase=EXCLUDED.phase, wisdom_voice=EXCLUDED.wisdom_voice,
           embedding=EXCLUDED.embedding`,
        [q.id, q.text, 'divorce_grief_expansion_v1', q.archetype, q.shadow, q.fn,
         q.depth, q.arena, q.risk, q.emotion, q.perma, q.trust, q.score,
         q.whisperer, q.silence_type, q.phase, q.wisdom_voice,
         vecStr, JSON.stringify({ series: q.id.split('-').slice(0, 2).join('-'), expansion: 'divorce_grief_v1' })]);
      inserted++;
    }
    console.log(`  ✓ ${inserted}/${QUESTIONS.length} inserted`);
  }

  console.log(`Done. ${inserted} questions ingested.`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
