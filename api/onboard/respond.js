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
    let transcript = '';
    try {
      transcript = await transcribeAudio(audioBase64);
    } catch (error) {
      console.error('stt_failed', error);
      return res.status(502).json({ success: false, message: 'stt_failed' });
    }
    if (!transcript) {
      return res.status(200).json({ success: false, message: 'transcription_failed' });
    }

    // 2) LLM (single call) + 3) validation
    let profile;
    try {
      profile = await extractProfileFromTranscript(transcript);
    } catch (error) {
      console.error('profile_extraction_failed', error);
      return res.status(502).json({ success: false, message: 'profile_extraction_failed' });
    }

    // 4) save profile
    try {
      await upsertUserProfile(userId, profile, transcript);
    } catch (error) {
      console.error('profile_save_failed', error);
      return res.status(500).json({ success: false, message: 'profile_save_failed' });
    }

    // 5) TTS responses
    const ackText = 'Got it. Setting up your profile.';
    const successText = 'Your profile is ready.';

    let ackAudio = '';
    let successAudio = '';
    try {
      [ackAudio, successAudio] = await Promise.all([
        synthesizeSpeech(ackText),
        synthesizeSpeech(successText),
      ]);
    } catch (error) {
      console.error('tts_failed_non_blocking', error);
    }

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
