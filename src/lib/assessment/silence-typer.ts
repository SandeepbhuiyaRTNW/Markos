/**
 * Silence Typer — Tier 2, §6.6
 * Classifies the type of silence present: shame, grief, avoidance, protective, honest_reflection.
 * Different silences require different responses:
 *   - Shame-silence wants PRESENCE
 *   - Grief-silence wants WITNESS
 *   - Avoidance-silence wants a BETTER QUESTION
 *   - Protective-silence wants RESPECT then gentle return
 *   - Honest reflection means no silence — just thinking
 */

import OpenAI from 'openai';
import type { SilenceTypeOutput, SilenceType } from '../agents/state-envelope';

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/** Run the Silence Typer against Listener Stack Layer 5 output */
export async function classifySilence(
  message: string,
  listenerSilence: string,
  conversationHistory: string,
  memoryContext: string,
  arena: string,
): Promise<SilenceTypeOutput> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You classify the TYPE of silence in a man's communication. This is critical — different silences need different responses.

SILENCE TYPES:
1. "shame" — He is hiding something he believes makes him defective, weak, or unworthy. Signs: deflection through humor, sudden topic shifts when getting close to something, minimizing ("it's not that bad"), vague references to things he "should have" done. The thing he won't say is something about HIMSELF.

2. "grief" — He is carrying loss he hasn't processed or named. Signs: talking around a death, loss, or ending without naming the emotion, referencing the person/thing lost in present tense, anger that seems disproportionate (grief wearing anger's mask), "I'm fine" when clearly not. The thing he won't say is that something DIED (literally or metaphorically).

3. "avoidance" — He is steering away from a known topic. Unlike shame, this isn't about self-concept — it's about a specific situation he doesn't want to face. Signs: changing the subject, answering a different question than was asked, "I don't want to talk about that," intellectualizing. The thing he won't say is a SPECIFIC FACT or SITUATION.

4. "protective" — He is protecting someone else by not saying something. Signs: careful word choice, "it's complicated," defending someone while simultaneously revealing harm, loyalty to a person who hurt him. The thing he won't say would IMPLICATE someone he loves.

5. "honest_reflection" — No active silence. He is genuinely thinking, processing, or being open. This is the absence of pathological silence. Signs: thoughtful pauses, self-awareness, naming emotions even imperfectly, asking himself questions.

Return JSON: { "label": "shame|grief|avoidance|protective|honest_reflection", "evidence": "specific textual evidence for classification", "confidence": 0.0-1.0 }

Be SPECIFIC in evidence. Not "he seems to be avoiding something" — cite the actual words or patterns.`
        },
        {
          role: 'user',
          content: `Message: "${message}"\nListener Stack Layer 5 (The Silence): ${listenerSilence}\nArena: ${arena}\nHistory: ${conversationHistory.substring(0, 500)}\nMemory: ${memoryContext.substring(0, 300)}`
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const parsed = JSON.parse(response.choices[0].message.content || '{}');
    const validTypes: SilenceType[] = ['shame', 'grief', 'avoidance', 'protective', 'honest_reflection'];
    const label = validTypes.includes(parsed.label) ? parsed.label : 'honest_reflection';

    return {
      label,
      evidence: parsed.evidence || 'No specific evidence identified',
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
    };
  } catch (err) {
    console.error('[SilenceTyper] Error:', err);
    return {
      label: 'honest_reflection',
      evidence: 'Classification unavailable — defaulting to honest_reflection',
      confidence: 0.3,
    };
  }
}

