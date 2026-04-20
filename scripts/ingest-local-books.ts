/**
 * Local Book + Training Doc Ingestion Pipeline
 * Ingests PDFs and .docx training docs from local filesystem into pgvector.
 *
 * Books → source_type='book' with domain tags (divorce, grief)
 * Training docs → source_type='training_doc' with domain + whisperer tags
 *
 * Usage: cd marcus-app && set -a && source .env.local && set +a && npx tsx scripts/ingest-local-books.ts
 */

import { Pool } from 'pg';
import OpenAI from 'openai';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const poolConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
};
let pool = new Pool(poolConfig);

async function dbQuery(sql: string, params: unknown[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await pool.query(sql, params);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('SSL') || msg.includes('Connection terminated') || msg.includes('ECONNRESET')) {
        console.log(`  ⚠ DB connection error (attempt ${attempt + 1}/3), reconnecting...`);
        try { await pool.end(); } catch {}
        pool = new Pool(poolConfig);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('DB query failed after 3 retries');
}

const TARGET_CHUNK_SIZE = 1200;
const MAX_CHUNK_SIZE = 1800;
const BATCH_SIZE = 10;

const BASE_DIR = '/Users/sandeepbhuiya/Documents/marcus updates/OneDrive_1_4-18-2026';

/** [local path, display title, domain, source_type, whisperer (for training docs)] */
type IngestionEntry = [string, string, string, 'book' | 'training_doc', string | null];

const LOCAL_SOURCES: IngestionEntry[] = [
  // DIVORCE BOOKS (3 PDFs)
  [`${BASE_DIR}/Divorce/335472376-Conscious-Uncoupling-e-Book.pdf`,
   'Conscious Uncoupling - Katherine Woodward Thomas', 'divorce', 'book', null],
  [`${BASE_DIR}/Divorce/730927927-The-Rebuilding-Workbook-Step-By-Step-Guidance-for-Healing-When-Your-Relationship-Ends-Will-Limon-MSW-Etc-Z-Library.pdf`,
   'The Rebuilding Workbook - Will Limón', 'divorce', 'book', null],
  [`${BASE_DIR}/Divorce/758359156-The-Divorce-Recovery-Book.pdf`,
   'The Divorce Recovery Book', 'divorce', 'book', null],
  // GRIEF BOOK (1 PDF)
  [`${BASE_DIR}/Grief/570747666-Robert-a-Neimeyer-Editor-Techniques-of-Grief-Therapy-Creative-Practices-for-Counseling-the-Bereaved-Routledge-2012.pdf`,
   'Techniques of Grief Therapy - Robert Neimeyer', 'grief', 'book', null],
  // DIVORCE TRAINING DOCS (3 docx)
  [`${BASE_DIR}/Divorce/divorce_consciousuncoupling_training_v1.docx`,
   'Training: Conscious Uncoupling', 'divorce', 'training_doc', 'divorce'],
  [`${BASE_DIR}/Divorce/mrkos_divorce_recoverybook_v1 (1).docx`,
   'Training: Divorce Recovery Book', 'divorce', 'training_doc', 'divorce'],
  [`${BASE_DIR}/Divorce/mrkos_rebuildingworkbook_training_v1.docx`,
   'Training: Rebuilding Workbook', 'divorce', 'training_doc', 'divorce'],
  // GRIEF TRAINING DOC (1 docx)
  [`${BASE_DIR}/Grief/markos_grief_whisperer_training_v1 (1).docx`,
   'Training: Grief Whisperer', 'grief', 'training_doc', 'grief'],
];

function cleanText(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n\s*\d{1,4}\s*\n/g, '\n')
    .replace(/^.*(?:copyright|all rights reserved|published by|isbn|library of congress).*$/gim, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function chunkText(text: string): string[] {
  const cleaned = cleanText(text);
  const paragraphs = cleaned.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20);
  const chunks: string[] = [];
  let currentChunk = '';
  for (const para of paragraphs) {
    if (currentChunk.length > 0 && currentChunk.length + para.length + 2 > TARGET_CHUNK_SIZE) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    if (para.length > MAX_CHUNK_SIZE) {
      if (currentChunk.length > 0) { chunks.push(currentChunk.trim()); currentChunk = ''; }
      const sentences = para.match(/[^.!?]+[.!?]+[\s"]*/g) || [para];
      let sc = '';
      for (const s of sentences) {
        if (sc.length + s.length > TARGET_CHUNK_SIZE && sc.length > 0) { chunks.push(sc.trim()); sc = ''; }
        sc += s;
      }
      if (sc.trim().length > 20) currentChunk = sc;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  if (currentChunk.trim().length > 20) chunks.push(currentChunk.trim());
  return chunks;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const resp = await openai.embeddings.create({ model: 'text-embedding-3-large', input: texts, dimensions: 3072 });
  return resp.data.map(d => d.embedding);
}

function extractText(filePath: string): string {
  if (filePath.endsWith('.pdf')) {
    try {
      return execSync(`pdftotext -layout "${filePath}" - 2>/dev/null`).toString();
    } catch {
      try { return execSync(`pdftotext "${filePath}" - 2>/dev/null`).toString(); }
      catch { return execSync(`strings "${filePath}"`).toString(); }
    }
  } else if (filePath.endsWith('.docx')) {
    return execSync(`textutil -convert txt -stdout "${filePath}" 2>/dev/null`).toString();
  }
  return readFileSync(filePath, 'utf-8');
}

async function main() {
  // Ensure source_type accepts 'training_doc' and 'doc'
  await dbQuery(`ALTER TABLE embeddings DROP CONSTRAINT IF EXISTS embeddings_source_type_check`, []).catch(() => {});
  await dbQuery(`ALTER TABLE embeddings ADD CONSTRAINT embeddings_source_type_check CHECK (source_type IN ('book', 'question', 'conversation', 'reflection', 'doc', 'training_doc'))`, []).catch(() => {});

  const reingest = process.argv.includes('--reingest');
  console.log(`=== Local Book + Training Doc Ingestion ===`);
  console.log(`Processing ${LOCAL_SOURCES.length} sources${reingest ? ' (REINGEST)' : ''}\n`);

  let totalChunks = 0, successCount = 0;
  for (let idx = 0; idx < LOCAL_SOURCES.length; idx++) {
    const [filePath, title, domain, sourceType, whisperer] = LOCAL_SOURCES[idx];
    console.log(`\n[${idx + 1}/${LOCAL_SOURCES.length}] ${title} (${domain}/${sourceType})`);
    const existing = await dbQuery(`SELECT COUNT(*) FROM embeddings WHERE source_title = $1`, [title]);
    if (parseInt(existing.rows[0].count) > 0 && !reingest) {
      console.log(`  ✓ Already ingested (${existing.rows[0].count} chunks), skipping`);
      totalChunks += parseInt(existing.rows[0].count); successCount++; continue;
    }
    try {
      console.log(`  Extracting text...`);
      const text = extractText(filePath);
      if (text.length < 200) { console.log(`  ⚠ Too little text (${text.length} chars), skipping`); continue; }
      console.log(`  Extracted ${text.length.toLocaleString()} characters`);
      const chunks = chunkText(text);
      console.log(`  Split into ${chunks.length} chunks`);
      if (reingest && parseInt(existing.rows[0].count) > 0) {
        await dbQuery(`DELETE FROM embeddings WHERE source_title = $1`, [title]);
      }
      // Find which chunks are already ingested (for resume after partial failure)
      const existingChunks = new Set<number>();
      if (!reingest) {
        const existingResult = await dbQuery(`SELECT chunk_index FROM embeddings WHERE source_title = $1`, [title]);
        for (const r of existingResult.rows) existingChunks.add(r.chunk_index);
      }
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        // Filter batch to only non-ingested chunks
        const batchIndices: number[] = [];
        const batchTexts: string[] = [];
        for (let j = 0; j < BATCH_SIZE && i + j < chunks.length; j++) {
          if (!existingChunks.has(i + j)) { batchIndices.push(i + j); batchTexts.push(chunks[i + j]); }
        }
        if (batchTexts.length === 0) { console.log(`  Skipped ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} (already ingested)`); continue; }
        const embeddings = await getEmbeddings(batchTexts);
        for (let j = 0; j < batchTexts.length; j++) {
          const vecStr = `[${embeddings[j].join(',')}]`;
          await dbQuery(
            `INSERT INTO embeddings (content, embedding, source_type, source_id, source_title, chunk_index, metadata)
             VALUES ($1, $2::vector, $3, $4, $5, $6, $7)`,
            [batchTexts[j], vecStr, sourceType, filePath, title, batchIndices[j],
             JSON.stringify({ domain, whisperer, book_index: idx })]);
        }
        console.log(`  Embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} chunks`);
        if (i + BATCH_SIZE < chunks.length) await new Promise(r => setTimeout(r, 1500));
      }
      totalChunks += chunks.length; successCount++;
      console.log(`  ✓ Done: ${chunks.length} chunks embedded`);
    } catch (err) { console.error(`  ✗ Error:`, err); }
  }
  console.log(`\n=== Summary: ${successCount}/${LOCAL_SOURCES.length} sources, ${totalChunks} total chunks ===`);
  const verify = await dbQuery(`SELECT source_title, source_type, COUNT(*) as chunks FROM embeddings WHERE source_type IN ('book','training_doc') GROUP BY source_title, source_type ORDER BY source_type, source_title`, []);
  for (const r of verify.rows) console.log(`  [${r.source_type}] ${r.source_title}: ${r.chunks} chunks`);
  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); pool.end(); process.exit(1); });

