import { synthesizeSpeech } from '../lib/onboarding.js';

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
    const body = parseBody(req);
    const name = String(body.user_name || 'there').trim();
    const fallbackText = `Hey ${name}, nice to meet you. Tell me your top skills and what work you want.`;
    const text = String(body.text || fallbackText).trim().slice(0, 180);

    if (!text) {
      return res.status(400).json({ success: false, message: 'invalid_text' });
    }

    const audioBase64 = await synthesizeSpeech(text, {
      languageCode: 'en-US',
      voiceName: 'en-US-Neural2-C',
      speakingRate: 1.02,
    });

    return res.status(200).json({ success: true, audio_base64: audioBase64 });
  } catch (error) {
    console.error('tts_failed', error);
    return res.status(500).json({ success: false, message: 'tts_failed' });
  }
}
