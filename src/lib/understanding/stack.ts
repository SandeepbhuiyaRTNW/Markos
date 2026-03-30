import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface UnderstandingAnalysis {
  layer1_words: string;          // What he literally said
  layer2_emotion: string;        // What he's feeling
  layer3_pattern: string;        // Recurring theme
  layer4_the_man: string;        // Identity/becoming
  layer5_the_silence: string;    // What's unsaid
  primary_emotion: string;
  depth_level: number;           // 1-5, how deep the conversation is
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
        content: `Analyze this man's message across all 5 layers of understanding. Return JSON:
{
  "layer1_words": "literal content summary",
  "layer2_emotion": "underlying emotion detected",
  "layer3_pattern": "recurring theme if visible, or 'none yet'",
  "layer4_the_man": "what this reveals about who he is/is becoming",
  "layer5_the_silence": "what he might be avoiding or not saying",
  "primary_emotion": "one word emotion",
  "depth_level": 1-5
}

Layer descriptions:
1. WORDS — surface content, facts stated
2. EMOTION — beneath the words: anger, grief, shame, hope, fear, pride, loneliness, confusion
3. PATTERN — themes that repeat: avoidance, self-sabotage, people-pleasing, isolation, control
4. THE MAN — his identity arc: who he was, who he is, who he could become
5. THE SILENCE — what's conspicuously absent: feelings unspoken, people unmentioned, topics avoided`
      },
      {
        role: 'user',
        content: `Message: "${userMessage}"\n\nConversation so far: ${conversationHistory}\n\nKnown about this man: ${memoryContext}`
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
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
  };
}

