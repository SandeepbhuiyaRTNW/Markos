/**
 * Cultural Context Sentinel — Tier 1, §5.6
 * Infers register, generation, faith background from utterance patterns.
 * Culture shapes every response — it's a Sentinel, not a Whisperer.
 */

import type { CulturalOutput } from '../agents/state-envelope';

/** Detect conversational register from message patterns */
function detectRegister(message: string): 'formal' | 'casual' | 'raw' | 'neutral' {
  const msg = message.toLowerCase();
  const casualPatterns = /\b(bro|yo|man|dude|lol|ngl|idk|tbh|bruh|fr|tripping|lowkey|vibes|chill|vibe|nah|gonna|gotta|wanna|kinda|sorta)\b/;
  const rawPatterns = /\b(can'?t do this|falling apart|don'?t care|what'?s the point|i'?m done|nothing matters|empty|numb|staring at|f[u*]ck|sh[i*]t|damn|hell|screw)\b/i;
  const formalPatterns = /\b(therefore|furthermore|however|nevertheless|consequently|regarding|concerning|aforementioned)\b/;

  if (rawPatterns.test(msg)) return 'raw';
  if (casualPatterns.test(msg)) return 'casual';
  if (formalPatterns.test(msg)) return 'formal';
  return 'neutral';
}

/** Detect faith context from explicit mentions */
function detectFaithContext(message: string): string | null {
  const msg = message.toLowerCase();
  if (/\b(church|jesus|christ|christian|bible|gospel|pastor|pray(ing|er|ed|s)?|god\s*(help|bless|knows)?|lord|faith)\b/.test(msg)) return 'christian';
  if (/\b(mosque|allah|quran|imam|muslim|islam|ramadan|salat|hajj)\b/.test(msg)) return 'muslim';
  if (/\b(synagogue|torah|rabbi|jewish|shabbat|kosher|bar\s*mitzvah)\b/.test(msg)) return 'jewish';
  if (/\b(temple|buddha|buddhist|meditation|dharma|sangha|mindful)\b/.test(msg)) return 'buddhist';
  if (/\b(temple|hindu|krishna|shiva|puja|karma|dharma|yoga)\b/.test(msg)) return 'hindu';
  if (/\b(atheist|agnostic|secular|don'?t\s*believe\s*in\s*god|no\s*religion)\b/.test(msg)) return 'secular';
  return null;
}

/** Infer generation from context clues */
function inferGeneration(message: string, sessionCount: number): string | null {
  const msg = message.toLowerCase();
  if (/\b(tiktok|instagram|influencer|ghosted|situationship|talking\s*stage)\b/.test(msg)) return 'gen_z_millennial';
  if (/\b(boomer|back\s*in\s*my\s*day|retirement|grandkids|vietnam|woodstock)\b/.test(msg)) return 'boomer';
  if (/\b(gen\s*x|latchkey|mtv|grunge)\b/.test(msg)) return 'gen_x';
  if (/\b(millennial|adulting|avocado|student\s*loans|crushing\s*it)\b/.test(msg)) return 'millennial';
  return null;
}

/** Run the Cultural Context sentinel */
export function runCulturalContext(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>,
  existingCultural?: CulturalOutput | null,
): CulturalOutput {
  const register = detectRegister(message);
  const faithContext = detectFaithContext(message) || existingCultural?.faith_context || null;
  const generation = inferGeneration(message, 0) || existingCultural?.generation || null;

  return {
    region: existingCultural?.region || null, // Region requires explicit disclosure or IP-based
    register,
    faith_context: faithContext,
    generation,
  };
}

