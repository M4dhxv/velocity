import { buildGreetingText, synthesizeSpeech } from '../../lib/onboarding.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'method_not_allowed' });
  }

  try {
    const greeting = buildGreetingText(req.query?.user_name);
    const audioBase64 = await synthesizeSpeech(greeting);
    return res.status(200).json({ audio_base64: audioBase64 });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'start_failed' });
  }
}
