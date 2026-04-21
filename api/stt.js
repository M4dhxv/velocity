function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function decodeBase64Audio(base64 = '') {
  const clean = String(base64 || '').trim();
  if (!clean) return null;
  return Buffer.from(clean, 'base64');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'method_not_allowed' });
  }

  try {
    const deepgramKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramKey) {
      return res.status(500).json({ success: false, message: 'missing_deepgram_key' });
    }

    const body = parseBody(req);
    const audioBase64 = body.audio_base64;
    const mimeType = String(body.mime_type || 'audio/webm');

    const audioBuffer = decodeBase64Audio(audioBase64);
    if (!audioBuffer || !audioBuffer.length) {
      return res.status(400).json({ success: false, message: 'invalid_audio' });
    }

    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramKey}`,
        'Content-Type': mimeType,
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`deepgram_stt_${response.status}: ${String(err).slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';

    return res.status(200).json({ success: true, text });
  } catch (error) {
    console.error('stt_failed', error);
    return res.status(500).json({ success: false, message: 'stt_failed' });
  }
}
