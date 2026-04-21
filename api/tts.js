function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'method_not_allowed' });
  }

  try {
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramApiKey) {
      return res.status(500).json({ success: false, message: 'missing_deepgram_key' });
    }

    const body = parseBody(req);
    const name = String(body.user_name || 'there').trim();
    const fallbackText = `Hey ${name}, nice to meet you. Tell me what you’re good at and what kind of work you’re looking for.`;
    const text = String(body.text || fallbackText).trim().slice(0, 180);

    if (!text) {
      return res.status(400).json({ success: false, message: 'invalid_text' });
    }

    console.log('Using Deepgram TTS');
    const response = await fetch('https://api.deepgram.com/v1/speak', {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, model: 'aura-asteria-en' }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({
        success: false,
        message: 'deepgram_tts_failed',
        detail: `deepgram_tts_failed_${response.status}: ${String(err).slice(0, 280)}`,
      });
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');

    return res.status(200).json({ success: true, audio_base64: audioBase64 });
  } catch (error) {
    console.error('tts_failed', error);
    return res.status(500).json({ success: false, message: 'tts_failed', detail: error?.message || 'unknown_error' });
  }
}
