import {
  extractProfileFromTranscript,
  synthesizeSpeech,
  transcribeAudio,
  upsertUserProfile,
} from '../../lib/onboarding.js';

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
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: 'onboard_respond_ready',
      expected_method: 'POST',
      required_body: {
        user_id: 'string',
        audio_base64: 'string',
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'method_not_allowed' });
  }

  try {
    const body = parseBody(req);
    const userId = body.user_id;
    const audioBase64 = body.audio_base64;

    if (!userId || !audioBase64 || typeof userId !== 'string' || typeof audioBase64 !== 'string') {
      return res.status(400).json({ success: false, message: 'invalid_input' });
    }

    // 1) STT
    const transcript = await transcribeAudio(audioBase64);
    if (!transcript) {
      return res.status(200).json({ success: false, message: 'transcription_failed' });
    }

    // 2) LLM (single call) + 3) validation
    const profile = await extractProfileFromTranscript(transcript);

    // 4) save profile
    await upsertUserProfile(userId, profile, transcript);

    // 5) TTS responses
    const ackText = 'Got it. Setting up your profile.';
    const successText = 'Your profile is ready.';

    const [ackAudio, successAudio] = await Promise.all([
      synthesizeSpeech(ackText),
      synthesizeSpeech(successText),
    ]);

    return res.status(200).json({
      success: true,
      ack_audio_base64: ackAudio,
      success_audio_base64: successAudio,
      profile,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'respond_failed' });
  }
}
