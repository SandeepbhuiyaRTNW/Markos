import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface UnderstandingAnalysis {
  layer1_words: string;          // What he literally said
  layer2_emotion: string;        // What he's feeling
  layer3_pattern: string;        // Recurring theme
  layer4_the_man: string;        // Identity/becoming
  layer5_the_silence: string;    // What's unsaid — THE DEPTH LEVER
  primary_emotion: string;
  depth_level: number;           // 1-5, how deep the conversation is
  depth_opportunity: string;     // Specific suggestion for going deeper
  silence_question: string;      // A question that would crack open Layer 5
  emotional_trajectory: string;  // Is he opening up, retreating, or flat?
}

export async function analyzeUnderstanding(
  userMessage: string,
  conversationHistory: string,
  memoryContext: string
): Promise<UnderstandingAnalysis> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are analyzing a man's message for a Stoic AI companion. Your analysis DIRECTLY shapes the depth and quality of the response. Be specific and actionable — not generic.

Return JSON:
{
  "layer1_words": "What he literally said — key facts, events, names mentioned",
  "layer2_emotion": "The emotion UNDERNEATH the words. Not what he claims to feel — what he IS feeling. Look for: anger masking hurt, humor masking pain, confidence masking fear, busyness masking avoidance",
  "layer3_pattern": "Recurring theme across this conversation and known history. Examples: 'avoidance of vulnerability', 'seeking permission he already has', 'deflecting through humor', 'caretaking others to avoid facing himself'. Say 'none yet' only if truly first message",
  "layer4_the_man": "What this reveals about his IDENTITY journey. Who was he? Who is he now? Who is he becoming or resisting becoming? This is not a summary — it is an insight about his self-concept",
  "layer5_the_silence": "THE MOST IMPORTANT LAYER. What is he NOT saying? What topic did he skip? What person did he not mention? What emotion did he avoid? What question would he never ask himself? Be SPECIFIC: 'He talks about his wife's anger but never mentions his own role' or 'He describes the loss but never uses the word grief' or 'He mentioned everyone else's needs but never his own'",
  "primary_emotion": "One word — the dominant emotion",
  "depth_level": "1-5 scale: 1=surface facts, 2=acknowledging feelings, 3=exploring patterns, 4=identity questioning, 5=confronting core truth",
  "depth_opportunity": "A specific, actionable suggestion for the companion to go DEEPER. Not generic ('go deeper') — specific: 'He mentioned his father but immediately pivoted to logistics. Return to what his father means to him.' or 'He used anger 3 times but hasn't named what the anger is protecting. Ask what is underneath it.'",
  "silence_question": "Write ONE specific question that would crack open Layer 5. This should be the question he is NOT asking himself. Example: 'When did you stop believing your needs mattered?' or 'What would you say to your father if you knew he could hear you?' This must be specific to HIS situation, not generic.",
  "emotional_trajectory": "Is he OPENING (becoming more vulnerable/honest), RETREATING (pulling back, getting more guarded), or FLAT (staying at same level)? Look at the conversation arc, not just this message."
}

CRITICAL RULES:
- Layer 5 must be SPECIFIC to this man, not generic. "He might be avoiding deeper feelings" is USELESS. "He described his wife's threats but never mentioned whether he still loves her" is ACTIONABLE.
- depth_opportunity must be a CONCRETE move the companion can make, not a platitude.
- silence_question must be a question that would make this specific man pause and think. Not a therapy cliché.
- If the conversation has been surface-level for multiple exchanges, say so explicitly in depth_opportunity.`
      },
      {
        role: 'user',
        content: `Message: "${userMessage}"\n\nConversation so far: ${conversationHistory}\n\nKnown about this man: ${memoryContext}`
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = response.choices[0].message.content || '{}';
  const parsed = JSON.parse(content);

  return {
    layer1_words: parsed.layer1_words || userMessage,
    layer2_emotion: parsed.layer2_emotion || 'unknown',
    layer3_pattern: parsed.layer3_pattern || 'none yet',
    layer4_the_man: parsed.layer4_the_man || 'still getting to know him',
    layer5_the_silence: parsed.layer5_the_silence || 'too early to tell',
    primary_emotion: parsed.primary_emotion || 'neutral',
    depth_level: parsed.depth_level || 1,
    depth_opportunity: parsed.depth_opportunity || '',
    silence_question: parsed.silence_question || '',
    emotional_trajectory: parsed.emotional_trajectory || 'flat',
  };
}

