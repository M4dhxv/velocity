import respondHandler from './respond.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: 'onboard_ready',
      expected_method: 'POST',
      required_body: {
        user_id: 'string',
        audio_base64: 'string',
      },
    });
  }

  return respondHandler(req, res);
}
