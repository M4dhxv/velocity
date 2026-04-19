import { upsertUserProfile } from '../../lib/onboarding.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'method_not_allowed' });
  }

  try {
    const debugUserId = `debug-save-${Date.now()}`;
    await upsertUserProfile(
      debugUserId,
      {
        skills: ['debug'],
        experience: '',
        interests: ['health-check'],
        work_type: 'any',
        level: 'intermediate',
      },
      'debug save health check'
    );

    return res.status(200).json({
      success: true,
      message: 'save_ok',
      user_id: debugUserId,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'save_failed',
      detail: error?.message || 'unknown_error',
    });
  }
}
