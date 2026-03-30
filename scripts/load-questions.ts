/**
 * Questions Loading Pipeline
 * Loads 11,592 structured questions from JSON into the database with embeddings
 *
 * Usage: npx tsx scripts/load-questions.ts
 */

import { Pool } from 'pg';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const BATCH_SIZE = 50;

interface QuestionRaw {
  id: string;
  content: string;
  metadata: {
    source?: string;
    archetype?: string;
    shadow?: string;
    function?: string;
    depth_level?: number;
    arena?: string;
    risk_polarity?: string;
    emotion_context?: string | string[];
    perma_domain?: string;
    trust_level?: string;
    effectiveness_score?: number;
    [key: string]: unknown;
  };
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts,
    dimensions: 3072,
  });
  return response.data.map(d => d.embedding);
}

async function main() {
  console.log('Loading questions into database...');

  // Load the JSON file
  const questionsPath = resolve(__dirname, '../../OneDrive_1_2-20-2026/Questions mrkos.ai/mrkos_questions_vectorstore.json');
  const raw = readFileSync(questionsPath, 'utf-8');
  const questions: QuestionRaw[] = JSON.parse(raw);
  console.log(`Loaded ${questions.length} questions from JSON`);

  // Check if already loaded
  const existing = await pool.query(`SELECT COUNT(*) FROM questions`);
  if (parseInt(existing.rows[0].count) > 0) {
    console.log(`Questions table already has ${existing.rows[0].count} rows. Clearing...`);
    await pool.query(`DELETE FROM questions`);
  }

  let loaded = 0;
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = questions.slice(i, i + BATCH_SIZE);
    const texts = batch.map(q => q.content);

    // Get embeddings for batch
    const embeddings = await getEmbeddings(texts);

    // Insert each question
    for (let j = 0; j < batch.length; j++) {
      const q = batch[j];
      const m = q.metadata || {};
      const emotionCtx = Array.isArray(m.emotion_context) ? m.emotion_context.join(',') : (m.emotion_context || null);
      const vecStr = `[${embeddings[j].join(',')}]`;
      await pool.query(
        `INSERT INTO questions (question_text, archetype, shadow, function, depth_level, arena,
         risk_polarity, emotion_context, perma_domain, trust_level, effectiveness_score, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)`,
        [
          q.content,
          m.archetype || null,
          m.shadow || null,
          m.function || null,
          m.depth_level || null,
          m.arena || null,
          m.risk_polarity || null,
          emotionCtx,
          m.perma_domain || null,
          m.trust_level || null,
          m.effectiveness_score || null,
          vecStr,
        ]
      );
    }

    loaded += batch.length;
    console.log(`Loaded ${loaded}/${questions.length} questions`);

    // Rate limiting for embeddings API
    if (i + BATCH_SIZE < questions.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Create vector index
  console.log('Creating questions vector index...');
  try {
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_questions_vector ON questions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`);
    console.log('Vector index created');
  } catch (e) {
    console.log('Vector index creation skipped:', e);
  }

  console.log(`\nDone. Loaded ${loaded} questions.`);
  await pool.end();
}

main().catch(console.error);

