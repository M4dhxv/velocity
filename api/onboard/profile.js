import { extractProfileFromTranscript, upsertUserProfile } from '../../lib/onboarding.js';

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
    const userId = String(body.user_id || '').trim();
    const transcript = String(body.transcript || '').trim();

    if (!userId || !transcript) {
      return res.status(400).json({ success: false, message: 'invalid_input' });
    }

    const profile = await extractProfileFromTranscript(transcript);
    await upsertUserProfile(userId, profile, transcript);

    return res.status(200).json({ success: true, profile });
  } catch (error) {
    console.error('profile_build_failed', error);
    return res.status(500).json({ success: false, message: 'profile_build_failed' });
  }
}
