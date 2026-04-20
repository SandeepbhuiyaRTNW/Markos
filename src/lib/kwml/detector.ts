import OpenAI from 'openai';
import { query } from '../db';

function getOpenAI() { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); }

export interface KWMLReading {
  king: number;
  warrior: number;
  magician: number;
  lover: number;
  dominant: string;
  kingShadow: string | null;
  warriorShadow: string | null;
  magicianShadow: string | null;
  loverShadow: string | null;
  shadowActive: boolean;
}

export async function detectKWML(
  userMessage: string,
  conversationHistory: string
): Promise<KWMLReading> {
  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Analyze the man's words for KWML archetypal expression. Return JSON:
{
  "king": 0.0-1.0,      // Order, purpose, blessing, leadership
  "warrior": 0.0-1.0,   // Discipline, boundaries, action, courage
  "magician": 0.0-1.0,  // Insight, knowledge, reflection, awareness
  "lover": 0.0-1.0,     // Connection, passion, feeling, empathy
  "dominant": "king|warrior|magician|lover",
  "king_shadow": null|"tyrant"|"weakling",
  "warrior_shadow": null|"sadist"|"masochist",
  "magician_shadow": null|"manipulator"|"innocent",
  "lover_shadow": null|"addicted"|"impotent",
  "shadow_active": true|false
}

Shadows appear when archetypes are imbalanced:
- Tyrant: controlling, demanding, inflexible. Weakling: no boundaries, people-pleasing
- Sadist: cruel discipline, punishing self/others. Masochist: doormat, no fight
- Manipulator: using knowledge to control. Innocent: refusing to see truth
- Addicted Lover: obsessive attachment. Impotent Lover: numb, disconnected`
      },
      {
        role: 'user',
        content: `Recent message: "${userMessage}"\n\nConversation context: ${conversationHistory}`
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0].message.content || '{}';
  const parsed = JSON.parse(content);

  return {
    king: parsed.king || 0,
    warrior: parsed.warrior || 0,
    magician: parsed.magician || 0,
    lover: parsed.lover || 0,
    dominant: parsed.dominant || 'magician',
    kingShadow: parsed.king_shadow || null,
    warriorShadow: parsed.warrior_shadow || null,
    magicianShadow: parsed.magician_shadow || null,
    loverShadow: parsed.lover_shadow || null,
    shadowActive: parsed.shadow_active || false,
  };
}

export async function getKWMLContext(userId: string): Promise<string> {
  const result = await query(
    `SELECT king_score, warrior_score, magician_score, lover_score,
            dominant_archetype, king_shadow, warrior_shadow, magician_shadow,
            lover_shadow, shadow_active
     FROM kwml_profiles WHERE user_id = $1
     ORDER BY assessed_at DESC LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) return 'No KWML profile assessed yet.';

  const p = result.rows[0];
  let ctx = `Dominant archetype: ${p.dominant_archetype}\n`;
  ctx += `King: ${p.king_score} | Warrior: ${p.warrior_score} | Magician: ${p.magician_score} | Lover: ${p.lover_score}\n`;
  if (p.shadow_active) {
    const shadows = [p.king_shadow, p.warrior_shadow, p.magician_shadow, p.lover_shadow].filter(Boolean);
    ctx += `Active shadows: ${shadows.join(', ')}`;
  }
  return ctx;
}

export async function saveKWMLProfile(
  userId: string,
  reading: KWMLReading,
  conversationId?: string
) {
  await query(
    `INSERT INTO kwml_profiles (user_id, king_score, warrior_score, magician_score, lover_score,
     dominant_archetype, king_shadow, warrior_shadow, magician_shadow, lover_shadow, shadow_active, conversation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [userId, reading.king, reading.warrior, reading.magician, reading.lover,
     reading.dominant, reading.kingShadow, reading.warriorShadow,
     reading.magicianShadow, reading.loverShadow, reading.shadowActive, conversationId]
  );
}

