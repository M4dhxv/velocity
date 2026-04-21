import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  buildGreetingText,
  buildOnboardingTtsTexts,
  extractProfileFromTranscript,
  getConfig,
  reverseGeocodeCityCountry,
  synthesizeSpeech,
  transcribeAudio,
  upsertUserLocation,
  upsertUserProfile,
} from './lib/onboarding.js';
import { ingestJobs } from './lib/jobs-ingestion.js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '15mb' }));

getConfig();

const STEP_ORDER = ['name', 'location', 'job_type', 'skills', 'done'];
const localConversationSessions = new Map();
const MODEL_FALLBACKS = ['gemini-2.5-flash', 'gemini-2.5-flash-latest', 'gemini-2.0-flash'];

function sanitizeConversationState(candidate = {}) {
  const step = STEP_ORDER.includes(candidate.step) ? candidate.step : 'name';
  const name = String(candidate.name || '').trim() || null;
  const city = String(candidate.city || '').trim() || null;
  const job = String(candidate.job_type || '').trim().toLowerCase();
  const jobType = ['remote', 'local', 'part-time'].includes(job) ? job : null;
  const skills = Array.isArray(candidate.skills)
    ? candidate.skills.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  return { step, name, city, job_type: jobType, skills };
}

function extractJsonObject(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
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

app.get('/api/onboard/start', async (req, res) => {
  try {
    const greeting = buildGreetingText(req.query?.user_name);
    const audioBase64 = await synthesizeSpeech(greeting);

    return res.json({ audio_base64: audioBase64 });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'start_failed' });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramApiKey) {
      return res.status(500).json({ success: false, message: 'missing_deepgram_key' });
    }

    const name = String(req.body?.user_name || 'there').trim();
    const fallbackText = `Hey ${name}, nice to meet you. Tell me what you're good at and what kind of work you're looking for.`;
    const text = String(req.body?.text || fallbackText).trim().slice(0, 180);
    if (!text) return res.status(400).json({ success: false, message: 'invalid_text' });

    console.log('Using Deepgram TTS');
    const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({
        success: false,
        message: 'deepgram_tts_failed',
        detail: `deepgram_tts_failed_${response.status}: ${String(err).slice(0, 280)}`,
      });
    }

    const audioBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');

    return res.status(200).json({ success: true, audio_base64: audioBase64 });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'tts_failed', detail: error?.message || 'unknown_error' });
  }
});

app.post('/api/stt', async (req, res) => {
  try {
    const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
    if (!deepgramApiKey) {
      return res.status(500).json({ success: false, message: 'missing_deepgram_key' });
    }

    const audioBase64 = String(req.body?.audio_base64 || '').trim();
    const mimeType = String(req.body?.mime_type || 'audio/webm');
    if (!audioBase64) {
      return res.status(400).json({ success: false, message: 'invalid_audio' });
    }

    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        'Content-Type': mimeType,
      },
      body: Buffer.from(audioBase64, 'base64'),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`deepgram_stt_failed_${response.status}: ${String(err).slice(0, 180)}`);
    }

    const data = await response.json();
    const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';
    return res.status(200).json({ success: true, text });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'stt_failed' });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    if (!geminiApiKey) {
      return res.status(500).json({ success: false, message: 'missing_gemini_key' });
    }

    const userId = String(req.body?.user_id || '').trim();
    const userInput = String(req.body?.user_input || req.body?.transcript || '').trim();
    const incomingState = sanitizeConversationState(req.body?.conversation_state || {});
    const shouldReset = Boolean(req.body?.reset);

    if (!userId) {
      return res.status(400).json({ success: false, message: 'missing_user_id' });
    }

    if (shouldReset) localConversationSessions.delete(userId);

    const stored = localConversationSessions.get(userId);
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
          lastError = `generate_failed_${response.status}: ${String(err).slice(0, 180)}`;
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
      throw new Error(lastError || 'gemini_invalid_json');
    }

    const safeResponse = String(parsed.response || '').replace(/\s+/g, ' ').trim();
    if (!safeResponse) {
      throw new Error('gemini_empty_response');
    }
    const updatedState = sanitizeConversationState(parsed.updated_state || {});
    const previousStep = baseState.step || 'name';
    const boundedNextStep = clampToStepOrder(previousStep, String(parsed.next_step || updatedState.step || previousStep));
    const normalized = enforceStepCompletion({ ...updatedState, step: boundedNextStep });

    localConversationSessions.set(userId, normalized);

    return res.status(200).json({
      success: true,
      response: safeResponse,
      updated_state: normalized,
      next_step: normalized.step,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'generate_failed', detail: error?.message || 'unknown_error' });
  }
});

app.post('/api/onboard/profile', async (req, res) => {
  try {
    const userId = String(req.body?.user_id || '').trim();
    const transcript = String(req.body?.transcript || '').trim();
    if (!userId || !transcript) {
      return res.status(400).json({ success: false, message: 'invalid_input' });
    }

    const profile = await extractProfileFromTranscript(transcript);
    await upsertUserProfile(userId, profile, transcript);
    return res.status(200).json({ success: true, profile });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'profile_build_failed' });
  }
});

app.post('/api/location', async (req, res) => {
  try {
    const userId = String(req.body?.user_id || '').trim();
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
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
    return res.status(200).json({ success: false, message: 'location_save_failed' });
  }
});

async function handleOnboardRespond(req, res) {
  try {
    const { user_id: userId, audio_base64: audioBase64 } = req.body || {};

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
      return res.json({ success: false, message: 'transcription_failed' });
    }

    // 2) LLM (single call) + 3) validation
    let profile;
    let llmDebug;
    try {
      const extraction = await extractProfileFromTranscript(transcript, { includeDebug: true });
      profile = extraction.profile;
      llmDebug = {
        model: extraction.model,
        context: extraction.context,
        prompt: extraction.prompt,
      };
    } catch (error) {
      console.error('profile_extraction_failed', error);
      return res.status(502).json({
        success: false,
        message: 'profile_extraction_failed',
        detail: error?.message || 'unknown_extraction_error',
      });
    }

    // 4) save profile
    try {
      await upsertUserProfile(userId, profile, transcript);
    } catch (error) {
      console.error('profile_save_failed', error);
      return res.status(500).json({
        success: false,
        message: 'profile_save_failed',
        detail: error?.message || 'unknown_save_error',
      });
    }

    // 5) TTS responses (post-save)
    const { ackText, successText } = buildOnboardingTtsTexts();

    let ackAudio = '';
    let successAudio = '';
    try {
      ackAudio = await synthesizeSpeech(ackText);
      successAudio = await synthesizeSpeech(successText);
    } catch (error) {
      console.error('tts_failed_non_blocking', error);
    }

    return res.json({
      success: true,
      ack_audio_base64: ackAudio,
      success_audio_base64: successAudio,
      profile,
      llm: llmDebug,
      tts: { ackText, successText },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'respond_failed' });
  }
}

app.post('/api/onboard/respond', handleOnboardRespond);

app.get('/api/onboard/respond', (_req, res) => {
  return res.status(200).json({
    success: true,
    message: 'onboard_respond_ready',
    expected_method: 'POST',
    required_body: {
      user_id: 'string',
      audio_base64: 'string',
    },
  });
});

app.post('/api/onboard', handleOnboardRespond);

app.get('/api/onboard', (_req, res) => {
  return res.status(200).json({
    success: true,
    message: 'onboard_ready',
    expected_method: 'POST',
    required_body: {
      user_id: 'string',
      audio_base64: 'string',
    },
  });
});

app.get('/api/onboard/debug-save', async (_req, res) => {
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
});

app.post('/api/jobs/ingest', async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET || process.env.INGEST_CRON_SECRET;
    if (secret) {
      const authHeader = String(req.headers?.authorization || '');
      const cronHeader = String(req.headers?.['x-cron-secret'] || '');
      const authorized = authHeader === `Bearer ${secret}` || cronHeader === secret;
      if (!authorized) {
        return res.status(401).json({ success: false, message: 'unauthorized' });
      }
    }

    const result = await ingestJobs({
      upworkInput: req.body?.upwork_input,
      upworkTargets: req.body?.upwork_targets,
      upworkDatasetIds: req.body?.upwork_dataset_ids,
      linkedinInput: req.body?.linkedin_input,
      linkedinDatasetIds: req.body?.linkedin_dataset_ids,
      useStoredRuns: req.body?.use_stored_runs,
      upworkActorId: req.body?.upwork_actor_id,
      linkedinActorId: req.body?.linkedin_actor_id,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'jobs_ingest_failed',
      detail: error?.message || 'unknown_error',
    });
  }
});

app.get('/api/jobs/ingest', async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET || process.env.INGEST_CRON_SECRET;
    if (secret) {
      const authHeader = String(req.headers?.authorization || '');
      const cronHeader = String(req.headers?.['x-cron-secret'] || '');
      const authorized = authHeader === `Bearer ${secret}` || cronHeader === secret;
      if (!authorized) {
        return res.status(401).json({ success: false, message: 'unauthorized' });
      }
    }

    const result = await ingestJobs();
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'jobs_ingest_failed',
      detail: error?.message || 'unknown_error',
    });
  }
});

app.listen(port, () => {
  console.log(`Voice onboarding backend listening on port ${port}`);
});
