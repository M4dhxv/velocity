import { reverseGeocodeCityCountry, upsertUserLocation } from '../lib/onboarding.js';

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
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!userId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, message: 'invalid_input' });
    }

    const location = await reverseGeocodeCityCountry(latitude, longitude);
    await upsertUserLocation(userId, location);

    return res.status(200).json({
      success: true,
      city: location.city || null,
      country: location.country || null,
    });
  } catch (error) {
    console.error('location_save_failed', error);
    return res.status(200).json({
      success: false,
      message: 'location_save_failed',
    });
  }
}
