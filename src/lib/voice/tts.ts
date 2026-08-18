// Same voice + model + settings for both the buffered and streaming variants — only
// the delivery differs. Do not diverge these; a change here changes Marcus's voice.
const TTS_MODEL_ID = 'eleven_multilingual_v2';
const VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.78,
  style: 0.15,
  use_speaker_boost: true,
} as const;

/**
 * Buffered synthesis — POSTs and waits for the full mp3. Still used by the session
 * opening path (a short one-shot greeting). The live voice turn uses the streaming
 * variant below.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey!,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: TTS_MODEL_ID, voice_settings: VOICE_SETTINGS }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs TTS error: ${response.status} - ${error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Streaming synthesis for the live voice turn. POSTs to the ElevenLabs *streaming*
 * endpoint and returns the raw audio ReadableStream so the route can pipe it to the
 * client as ElevenLabs produces it — the user hears the first words without waiting for
 * the whole clip. SAME voice, model, and settings as synthesizeSpeech: only the
 * delivery (a stream vs a fully-buffered Buffer) differs, so the audio is byte-
 * equivalent, just delivered progressively.
 */
export async function synthesizeSpeechStream(text: string): Promise<ReadableStream<Uint8Array>> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey!,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({ text, model_id: TTS_MODEL_ID, voice_settings: VOICE_SETTINGS }),
    }
  );

  if (!response.ok || !response.body) {
    const error = await response.text().catch(() => '');
    throw new Error(`ElevenLabs streaming TTS error: ${response.status} - ${error}`);
  }

  return response.body;
}
