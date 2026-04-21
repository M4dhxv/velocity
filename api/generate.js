function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function toTwoSentences(text = '') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, 2).join(' ').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'method_not_allowed' });
  }

  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!geminiApiKey) {
      return res.status(500).json({ success: false, message: 'missing_gemini_key' });
    }

    const body = parseBody(req);
    const transcript = String(body.transcript || '').trim();
    const city = String(body.city || '').trim();
    const country = String(body.country || '').trim();

    if (!transcript) {
      return res.status(400).json({ success: false, message: 'missing_transcript' });
    }

    const contextLocation = city
      ? `User location is ${city}${country ? `, ${country}` : ''}.`
      : 'No user location available.';

    const prompt = [
      'You are a friendly onboarding assistant for a gig marketplace.',
      'Rules:',
      '- max 2 sentences total',
      '- casual, human tone',
      '- sound calm, warm, and slightly thoughtful',
      '- include pauses using "..."',
      '- lightly use fillers like "hmm", "okay", "yeah", or "oh" when natural',
      '- reference skills briefly from the user transcript',
      '- if city is available, mention it naturally',
      '- do not explain process',
      '- do not repeat input verbatim',
      contextLocation,
      `User said: "${transcript}"`,
      'Return ONLY the response text.',
    ].join('\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 90,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`gemini_generate_${response.status}: ${String(err).slice(0, 200)}`);
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const output = toTwoSentences(text) || 'Got it... let me find something that fits you.';

    return res.status(200).json({ success: true, text: output });
  } catch (error) {
    console.error('generate_failed', error);
    return res.status(500).json({ success: false, message: 'generate_failed' });
  }
}
