function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

const STEP_ORDER = ['name', 'location', 'job_type', 'skills', 'done'];
const sessionConversations = new Map();

function extractJsonObject(rawText = '') {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function sanitizeConversationState(candidate = {}) {
  const step = STEP_ORDER.includes(candidate.step) ? candidate.step : 'name';
  const name = String(candidate.name || '').trim() || null;
  const city = String(candidate.city || '').trim() || null;
  const normalizedJob = String(candidate.job_type || '').trim().toLowerCase();
  const jobType = ['remote', 'local', 'part-time'].includes(normalizedJob) ? normalizedJob : null;

  const skills = Array.isArray(candidate.skills)
    ? candidate.skills
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 8)
    : [];

  return {
    step,
    name,
    city,
    job_type: jobType,
    skills,
  };
}

function clampToStepOrder(previousStep, requestedStep) {
  const prevIndex = STEP_ORDER.indexOf(previousStep);
  const reqIndex = STEP_ORDER.indexOf(requestedStep);
  if (prevIndex === -1 || reqIndex === -1) return previousStep || 'name';
  if (reqIndex < prevIndex) return previousStep;
  if (reqIndex > prevIndex + 1) return STEP_ORDER[Math.min(prevIndex + 1, STEP_ORDER.length - 1)];
  return requestedStep;
}

function enforceStepCompletion(state = {}) {
  const s = sanitizeConversationState(state);
  if (!s.name) return { ...s, step: 'name' };
  if (!s.city) return { ...s, step: 'location' };
  if (!s.job_type) return { ...s, step: 'job_type' };
  if (!s.skills.length) return { ...s, step: 'skills' };
  return { ...s, step: 'done' };
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
    const userId = String(body.user_id || '').trim();
    const userInput = String(body.user_input || body.transcript || '').trim();
    const incomingState = sanitizeConversationState(body.conversation_state || {});
    const shouldReset = Boolean(body.reset);

    if (!userId) {
      return res.status(400).json({ success: false, message: 'missing_user_id' });
    }

    if (shouldReset) {
      sessionConversations.delete(userId);
    }

    const stored = sessionConversations.get(userId);
    const baseState = stored || incomingState;

    const prompt = [
      'You are a friendly onboarding assistant having a real conversation.',
      '',
      'RULES',
      '- Ask ONE question at a time',
      '- Max 2 sentences',
      '- Use fillers: "hmm", "okay", "nice", "oh"',
      '- React to user input',
      '- Be casual, not formal',
      '- Do NOT explain',
      '- Do NOT ask multiple questions',
      '- Strict step order: name -> location -> job_type -> skills -> done',
      '- job_type must be exactly one of: remote, local, part-time',
      '- skills must be a list of concrete tools/domains',
      '',
      'CONTEXT',
      `Conversation state: ${JSON.stringify(baseState)}`,
      `User input: ${JSON.stringify(userInput)}`,
      '',
      'TASK',
      '1. Extract relevant info',
      '2. Update state',
      '3. Decide next step',
      '4. Generate natural response',
      '',
      'OUTPUT FORMAT (STRICT JSON)',
      '{',
      '  "response": "text to speak",',
      '  "updated_state": {',
      '    "step": "name|location|job_type|skills|done",',
      '    "name": null,',
      '    "city": null,',
      '    "job_type": null,',
      '    "skills": []',
      '  },',
      '  "next_step": "name|location|job_type|skills|done"',
      '}',
      'Return ONLY JSON.',
    ].join('\n');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 220,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`gemini_generate_${response.status}: ${String(err).slice(0, 200)}`);
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = extractJsonObject(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('gemini_invalid_json');
    }

    const safeResponse = String(parsed.response || '').replace(/\s+/g, ' ').trim();
    const updatedState = sanitizeConversationState(parsed.updated_state || {});
    const previousStep = baseState.step || 'name';
    const boundedNextStep = clampToStepOrder(previousStep, String(parsed.next_step || updatedState.step || previousStep));
    const normalized = enforceStepCompletion({
      ...updatedState,
      step: boundedNextStep,
    });

    if (!safeResponse) {
      throw new Error('gemini_empty_response');
    }
    sessionConversations.set(userId, normalized);

    return res.status(200).json({
      success: true,
      response: safeResponse,
      updated_state: normalized,
      next_step: normalized.step,
    });
  } catch (error) {
    console.error('generate_failed', error);
    return res.status(500).json({ success: false, message: 'generate_failed', detail: error?.message || 'unknown_error' });
  }
}
