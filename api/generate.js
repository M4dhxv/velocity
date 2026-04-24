function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function cleanNullableString(value) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return null;
  return text;
}

const STEP_ORDER = ['name', 'location', 'job_type', 'skills', 'done'];
const sessionConversations = new Map();
const MODEL_FALLBACKS = [];

function buildFallbackConversationResponse(baseState, userInput) {
  const text = String(userInput || '').trim();
  const normalized = sanitizeConversationState(baseState);
  const updated = {
    ...normalized,
    step: text ? 'done' : 'name',
  };

  return {
    response: text
      ? 'Nice, I’ve got enough to build your profile now.'
      : 'Hey — what should I call you?',
    updated_state: updated,
    next_step: updated.step,
  };
}

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
  const name = cleanNullableString(candidate.name);
  const city = cleanNullableString(candidate.city);
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

    const candidateModels = [geminiModel, ...MODEL_FALLBACKS.filter((m) => m !== geminiModel)];
    let parsed = null;
    let lastError = '';

    for (const model of candidateModels) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 220,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: 'OBJECT',
                  required: ['response', 'updated_state', 'next_step'],
                  properties: {
                    response: { type: 'STRING' },
                    updated_state: {
                      type: 'OBJECT',
                      required: ['step', 'name', 'city', 'job_type', 'skills'],
                      properties: {
                        step: { type: 'STRING', enum: STEP_ORDER },
                        name: { type: 'STRING' },
                        city: { type: 'STRING' },
                        job_type: { type: 'STRING', enum: ['remote', 'local', 'part-time'] },
                        skills: { type: 'ARRAY', items: { type: 'STRING' } },
                      },
                    },
                    next_step: { type: 'STRING', enum: STEP_ORDER },
                  },
                },
              },
            }),
          }
        );

        if (!response.ok) {
          const err = await response.text();
          lastError = `gemini_generate_${response.status}: ${String(err).slice(0, 200)}`;
          if (response.status === 404) break;
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          break;
        }

        const data = await response.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        parsed = extractJsonObject(raw);
        if (parsed && typeof parsed === 'object') break;
        lastError = 'gemini_invalid_json';
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
      }
      if (parsed && typeof parsed === 'object') break;
    }

    if (!parsed || typeof parsed !== 'object') {
      const fallback = buildFallbackConversationResponse(baseState, userInput);
      sessionConversations.set(userId, sanitizeConversationState(fallback.updated_state));

      return res.status(200).json({
        success: true,
        response: fallback.response,
        updated_state: fallback.updated_state,
        next_step: fallback.next_step,
        fallback_used: true,
        detail: lastError || 'gemini_invalid_json',
      });
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
      const fallback = buildFallbackConversationResponse(baseState, userInput);
      sessionConversations.set(userId, sanitizeConversationState(fallback.updated_state));

      return res.status(200).json({
        success: true,
        response: fallback.response,
        updated_state: fallback.updated_state,
        next_step: fallback.next_step,
        fallback_used: true,
        detail: 'gemini_empty_response',
      });
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
