/**
 * Book Ingestion Pipeline — Curated 10-Book Selection
 * Downloads PDFs from S3, extracts text, chunks, embeds with OpenAI, stores in pgvector
 *
 * Usage: cd marcus-app && npx tsx scripts/ingest-books.ts
 * Requires .env.local to be loaded (use: set -a && source .env.local && set +a)
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import OpenAI from 'openai';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const TARGET_CHUNK_SIZE = 1200; // target, not hard limit — we respect paragraph boundaries
const MAX_CHUNK_SIZE = 1800;    // absolute max before we force-split
const BATCH_SIZE = 20;

/**
 * 10 curated books across all key domains for the Marcus agent
 * Each entry: [S3 key, display title, domain tag]
 */
const CURATED_BOOKS: [string, string, string][] = [
  // STOIC PRIMARY SOURCES (3)
  ['books/STOIC PRIMARY SOURCES/meditations.pdf', 'Meditations - Marcus Aurelius', 'stoic'],
  ['books/STOIC PRIMARY SOURCES/Epictetus_Handbook.pdf', 'Enchiridion - Epictetus', 'stoic'],
  ['books/STOIC PRIMARY SOURCES/Letters from a Stoic 1.pdf', 'Letters from a Stoic - Seneca', 'stoic'],
  // MALE PSYCHOLOGY & KWML (3)
  ['books/MALE PSYCHOLOGY & MASCULINITY/king-warrior-magician-lover---rediscovering-the-archetypes-of-the-mature-masculine.pdf', 'King Warrior Magician Lover - Moore & Gillette', 'kwml'],
  ['books/MALE PSYCHOLOGY & MASCULINITY/robert_bly_-_iron_john.pdf', 'Iron John - Robert Bly', 'masculinity'],
  ['books/MALE PSYCHOLOGY & MASCULINITY/No More Mr. Nice Guy by Robert Glover (1).pdf', 'No More Mr Nice Guy - Robert Glover', 'masculinity'],
  // MEANING & EXISTENTIAL (1)
  ['books/MEANING & EXISTENTIAL PSYCHOLOGY/mans-search-for-meaning.pdf', "Man's Search for Meaning - Viktor Frankl", 'meaning'],
  // PHILOSOPHY WAY OF LIFE (1)
  ['books/Philosophy_Way_of_Life/The_Daily_Stoic_366_Meditations_on_Wisdom,_Perseverance,_and_the.pdf', 'The Daily Stoic - Ryan Holiday', 'stoic_practice'],
  // JUNGIAN PSYCHOLOGY (1)
  ['books/JUNGIAN PSYCHOLOGY & SHADOW WORK/Owning Your Own Shadow_ Understanding the Dark Side of the Psyche ( PDFDrive.com ).pdf', 'Owning Your Own Shadow - Robert A. Johnson', 'shadow'],
  // POSITIVE PSYCHOLOGY / PERMA (1)
  ['books/POSITIVE PSYCHOLOGY & FLOURISHING/flourish_seligman.pdf', 'Flourish - Martin Seligman', 'perma'],
];

/**
 * Clean raw extracted text:
 * - Strip control chars, excessive whitespace
 * - Remove common PDF artifacts (page numbers, headers/footers, copyright lines)
 * - Normalize paragraph breaks
 */
function cleanText(raw: string): string {
  return raw
    // Remove control chars
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    // Normalize line breaks: collapse 3+ newlines into 2 (paragraph break)
    .replace(/\n{3,}/g, '\n\n')
    // Remove standalone page numbers (lines that are just a number)
    .replace(/\n\s*\d{1,4}\s*\n/g, '\n')
    // Remove common header/footer patterns
    .replace(/^.*(?:copyright|all rights reserved|published by|isbn|library of congress).*$/gim, '')
    // Collapse multiple spaces
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Paragraph-aware chunking:
 * 1. Split text into paragraphs (double newline)
 * 2. Group paragraphs into chunks up to TARGET_CHUNK_SIZE
 * 3. If a single paragraph exceeds MAX_CHUNK_SIZE, split at sentence boundaries
 * 4. Never cut mid-sentence
 */
function chunkText(text: string, _chunkSize?: number, _overlap?: number): string[] {
  const cleaned = cleanText(text);
  const paragraphs = cleaned.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 20);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    // If adding this paragraph would exceed target and we have content, flush
    if (currentChunk.length > 0 && currentChunk.length + para.length + 2 > TARGET_CHUNK_SIZE) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }

    // If a single paragraph is too large, split at sentence boundaries
    if (para.length > MAX_CHUNK_SIZE) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      const sentences = para.match(/[^.!?]+[.!?]+[\s"]*/g) || [para];
      let sentenceChunk = '';
      for (const sentence of sentences) {
        if (sentenceChunk.length + sentence.length > TARGET_CHUNK_SIZE && sentenceChunk.length > 0) {
          chunks.push(sentenceChunk.trim());
          sentenceChunk = '';
        }
        sentenceChunk += sentence;
      }
      if (sentenceChunk.trim().length > 20) {
        currentChunk = sentenceChunk;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim().length > 20) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts,
    dimensions: 3072,
  });
  return response.data.map(d => d.embedding);
}

async function extractTextFromPDF(pdfBuffer: Buffer, filename: string): Promise<string> {
  const tmpPath = join(tmpdir(), `mrkos-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  const txtPath = tmpPath.replace('.pdf', '.txt');
  try {
    writeFileSync(tmpPath, pdfBuffer);
    try {
      execSync(`pdftotext -layout "${tmpPath}" "${txtPath}" 2>/dev/null`);
      return readFileSync(txtPath, 'utf-8');
    } catch {
      try {
        execSync(`pdftotext "${tmpPath}" "${txtPath}" 2>/dev/null`);
        return readFileSync(txtPath, 'utf-8');
      } catch {
        const output = execSync(`strings "${tmpPath}"`).toString();
        return output;
      }
    }
  } finally {
    try { unlinkSync(tmpPath); } catch {}
    try { unlinkSync(txtPath); } catch {}
  }
}

async function main() {
  const reingest = process.argv.includes('--reingest');
  console.log('=== mrkos.ai Book Ingestion Pipeline ===');
  console.log(`Processing ${CURATED_BOOKS.length} curated books${reingest ? ' (REINGEST MODE — replacing all chunks)' : ''}\n`);

  let totalChunks = 0;
  let successCount = 0;

  for (let idx = 0; idx < CURATED_BOOKS.length; idx++) {
    const [s3Key, title, domain] = CURATED_BOOKS[idx];
    console.log(`\n[${idx + 1}/${CURATED_BOOKS.length}] ${title} (${domain})`);

    // Check if already ingested
    const existing = await pool.query(
      `SELECT COUNT(*) FROM embeddings WHERE source_title = $1 AND source_type = 'book'`,
      [title]
    );
    if (parseInt(existing.rows[0].count) > 0 && !reingest) {
      console.log(`  ✓ Already ingested (${existing.rows[0].count} chunks), skipping`);
      totalChunks += parseInt(existing.rows[0].count);
      successCount++;
      continue;
    }
    // NOTE: if reingest, we delete AFTER successful download + chunking (see below)

    // Download from S3
    try {
      console.log(`  Downloading from S3...`);
      const getCmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: s3Key });
      const obj = await s3.send(getCmd);
      const bodyBytes = await obj.Body!.transformToByteArray();
      const pdfBuffer = Buffer.from(bodyBytes);
      console.log(`  Downloaded ${(pdfBuffer.length / 1024 / 1024).toFixed(1)} MB`);

      // Extract text
      console.log(`  Extracting text...`);
      const text = await extractTextFromPDF(pdfBuffer, title);
      if (text.length < 200) {
        console.log(`  ⚠ Skipping: too little text extracted (${text.length} chars)`);
        continue;
      }
      console.log(`  Extracted ${text.length.toLocaleString()} characters`);

      // Chunk
      const chunks = chunkText(text);
      console.log(`  Split into ${chunks.length} chunks`);

      // If reingest, delete OLD chunks only AFTER successful download + chunking
      if (reingest && parseInt(existing.rows[0].count) > 0) {
        console.log(`  🔄 Deleting ${existing.rows[0].count} old chunks (download + chunking succeeded)...`);
        await pool.query(`DELETE FROM embeddings WHERE source_title = $1 AND source_type = 'book'`, [title]);
      }

      // Embed and store in batches
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const embeddings = await getEmbeddings(batch);

        for (let j = 0; j < batch.length; j++) {
          const vecStr = `[${embeddings[j].join(',')}]`;
          await pool.query(
            `INSERT INTO embeddings (content, embedding, source_type, source_id, source_title, chunk_index, metadata)
             VALUES ($1, $2::vector, 'book', $3, $4, $5, $6)`,
            [batch[j], vecStr, s3Key, title, i + j, JSON.stringify({ domain, book_index: idx })]
          );
        }
        const progress = Math.min(i + BATCH_SIZE, chunks.length);
        console.log(`  Embedded ${progress}/${chunks.length} chunks`);

        // Rate limiting
        if (i + BATCH_SIZE < chunks.length) await new Promise(r => setTimeout(r, 500));
      }

      totalChunks += chunks.length;
      successCount++;
      console.log(`  ✓ Done: ${chunks.length} chunks embedded`);
    } catch (err) {
      console.error(`  ✗ Error processing ${title}:`, err);
    }
  }

  // Summary
  console.log('\n=== Ingestion Summary ===');
  console.log(`Books processed: ${successCount}/${CURATED_BOOKS.length}`);
  console.log(`Total chunks: ${totalChunks}`);

  // Verify
  const verifyResult = await pool.query(
    `SELECT source_title, COUNT(*) as chunks FROM embeddings WHERE source_type = 'book' GROUP BY source_title ORDER BY source_title`
  );
  console.log('\nEmbedded books:');
  for (const row of verifyResult.rows) {
    console.log(`  ${row.source_title}: ${row.chunks} chunks`);
  }

  // Create IVFFlat index if enough data
  if (totalChunks > 100) {
    console.log('\nCreating IVFFlat vector index...');
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)`);
      console.log('✓ Vector index created');
    } catch (e) {
      console.log('Vector index creation note:', e);
    }
  }

  console.log('\n✓ Book ingestion complete.');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});

