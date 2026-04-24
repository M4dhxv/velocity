import { createClient } from '@supabase/supabase-js';

const VALID_WORK_TYPES = new Set(['remote', 'local', 'part-time', 'full-time', 'any']);
const VALID_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const NOISE_WORDS = new Set([
  'ok', 'okay', 'looking', 'for', 'job', 'jobs', 'gig', 'gigs', 'work', 'works',
  'role', 'roles', 'want', 'wanted', 'need', 'needed', 'just', 'like', 'maybe',
  'please', 'thanks', 'thank', 'you', 'i', 'im', "i'm", 'am', 'a', 'an', 'the',
]);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

export function getConfig() {
  return {
    googleApiKey: requiredEnv('GOOGLE_API_KEY'),
    geminiApiKey: requiredEnv('GEMINI_API_KEY'),
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    supabaseUrl: requiredEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

function getMapsApiKey() {
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  const sharedKey = process.env.GOOGLE_API_KEY;
  const value = mapsKey || sharedKey;
  if (!value) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY or GOOGLE_API_KEY');
  }
  return value;
}

let cachedSupabase = null;
export function getSupabaseClient() {
  if (cachedSupabase) return cachedSupabase;

  const supabaseUrl = requiredEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  cachedSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedSupabase;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .map((item) => item.replace(/[“”"'`]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function sanitizeSkillLikeArray(value) {
  const cleaned = cleanStringArray(value);
  const seen = new Set();

  return cleaned
    .filter((item) => {
      const lower = item.toLowerCase();
      if (NOISE_WORDS.has(lower)) return false;
      const parts = lower.split(/\s+/).filter(Boolean);
      if (!parts.length) return false;
      const meaningful = parts.filter((p) => !NOISE_WORDS.has(p));
      return meaningful.length > 0;
    })
    .map((item) => item.replace(/\bfront-end\b/gi, 'frontend'))
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractJsonObject(rawText = '') {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    const maybeJson = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(maybeJson);
    } catch {
      return null;
    }
  }
}

export function validateProfile(candidate = {}) {
  const skills = sanitizeSkillLikeArray(candidate.skills);
  const interests = sanitizeSkillLikeArray(candidate.interests);

  const experience = typeof candidate.experience === 'string'
    ? candidate.experience.trim()
    : '';

  const workType = typeof candidate.work_type === 'string' && VALID_WORK_TYPES.has(candidate.work_type)
    ? candidate.work_type
    : 'any';

  const level = typeof candidate.level === 'string' && VALID_LEVELS.has(candidate.level)
    ? candidate.level
    : 'intermediate';

  return {
    skills,
    experience,
    interests,
    work_type: workType,
    level,
  };
}

export function buildGreetingText(userName) {
  const name = typeof userName === 'string' && userName.trim() ? userName.trim() : 'there';
  return `Hi ${name}, how are you? Tell me about yourself—your skills and what kind of work you're looking for.`;
}

export function buildProfileExtractionContext(transcript) {
  return {
    task: 'Extract structured onboarding profile from user transcript',
    transcript,
    output_schema: {
      skills: 'string[]',
      experience: 'string',
      interests: 'string[]',
      work_type: 'remote|local|part-time|full-time|any|""',
      level: 'beginner|intermediate|advanced|""',
    },
  };
}

export function buildProfileExtractionPrompt(transcript) {
  return `Return ONLY valid JSON.\n\nExtract detailed structured profile from this text:\n"${transcript}"\n\nSTRICT RULES:\n- DO NOT default to generic skills like "communication"\n- Extract ACTUAL mentioned skills (e.g. react, python, sales, video editing)\n- If tech stack is mentioned, include it in skills\n- If nothing is found, return empty arrays (not generic values)\n- No markdown, no explanation, JSON only\n\nReturn exactly:\n{\n  "skills": [],\n  "experience": "",\n  "interests": [],\n  "work_type": "",\n  "level": ""\n}`;
}

export function buildOnboardingTtsTexts() {
  return {
    ackText: 'Got it. Building your profile now.',
    successText: 'Your profile is ready. Here are your top matches.',
  };
}

function requiredDeepgramApiKey() {
  const value = process.env.DEEPGRAM_API_KEY;
  if (!value) {
    throw new Error('Missing DEEPGRAM_API_KEY');
  }
  return value;
}

export async function synthesizeSpeechDeepgram(text, options = {}) {
  const deepgramApiKey = requiredDeepgramApiKey();
  const model = options.model || 'aura-asteria-en';
  const input = String(text || '').trim();
  if (!input) return '';

  console.log('Using Deepgram TTS');
  const response = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${deepgramApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: input }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TTS failed: ${response.status} ${String(err).slice(0, 180)}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  return audioBuffer.toString('base64');
}

export async function transcribeAudioDeepgram(audioBase64, options = {}) {
  const deepgramApiKey = requiredDeepgramApiKey();
  const mimeType = options.mimeType || 'audio/webm';
  const model = options.model || 'nova-2';
  const audioBuffer = Buffer.from(String(audioBase64 || ''), 'base64');
  if (!audioBuffer.length) return '';

  const response = await fetch(
    `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${deepgramApiKey}`,
        'Content-Type': mimeType,
      },
      body: audioBuffer,
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`STT failed: ${response.status} ${String(err).slice(0, 180)}`);
  }

  const data = await response.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '';
}

export async function synthesizeSpeech(text, options = {}) {
  return synthesizeSpeechDeepgram(text, { model: options.model || 'aura-asteria-en' });
}

export async function reverseGeocodeCityCountry(latitude, longitude) {
  const mapsApiKey = getMapsApiKey();
  const lat = Number(latitude);
  const lng = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('invalid_coordinates');
  }

  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${lat},${lng}`)}&key=${mapsApiKey}`
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`geocode_http_${response.status}: ${String(err).slice(0, 180)}`);
  }

  const data = await response.json();
  const results = Array.isArray(data?.results) ? data.results : [];

  let city = '';
  let country = '';

  for (const result of results) {
    const components = Array.isArray(result?.address_components) ? result.address_components : [];
    for (const comp of components) {
      const types = Array.isArray(comp?.types) ? comp.types : [];
      if (!city && (types.includes('locality') || types.includes('administrative_area_level_2'))) {
        city = comp.long_name || comp.short_name || city;
      }
      if (!country && types.includes('country')) {
        country = comp.long_name || comp.short_name || country;
      }
    }
    if (city && country) break;
  }

  return {
    city: String(city || '').trim(),
    country: String(country || '').trim(),
  };
}

export async function transcribeAudio(audioBase64) {
  return transcribeAudioDeepgram(audioBase64, { mimeType: 'audio/webm', model: 'nova-2' });
}

export async function extractProfileFromTranscript(transcript, options = {}) {
  const { includeDebug = false } = options;
  const geminiApiKey = requiredEnv('GEMINI_API_KEY');
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  const context = buildProfileExtractionContext(transcript);
  const prompt = buildProfileExtractionPrompt(transcript);

  const modelCandidates = [
    geminiModel,
    'gemini-2.5-flash',
    'gemini-2.5-flash-latest',
    'gemini-2.0-flash',
  ];

  let data = null;
  let selectedModel = geminiModel;
  let lastError = '';

  for (const model of modelCandidates) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: 'You extract concise structured onboarding profiles. Output strict JSON only. Skills must be concrete tools/domains (e.g., React, Python, Sales, Video editing), never filler words.' }],
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'OBJECT',
                required: ['skills', 'experience', 'interests', 'work_type', 'level'],
                properties: {
                  skills: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                  },
                  experience: { type: 'STRING' },
                  interests: {
                    type: 'ARRAY',
                    items: { type: 'STRING' },
                  },
                  work_type: {
                    type: 'STRING',
                    enum: ['remote', 'local', 'part-time', 'full-time', 'any'],
                  },
                  level: {
                    type: 'STRING',
                    enum: ['beginner', 'intermediate', 'advanced'],
                  },
                },
              },
            },
          }),
        }
      );

      if (response.ok) {
        data = await response.json();
        selectedModel = model;
        break;
      }

      const err = await response.text();
      lastError = `gemini_http_${response.status}: ${String(err).slice(0, 180)}`;

      console.error(`[extractProfileFromTranscript] Model ${model} failed:`, lastError);

      // If it's not a not-found model error, fail immediately.
      if (response.status !== 404) {
        throw new Error(lastError);
      }
    } catch (e) {
      lastError = e?.message || 'gemini_fetch_error';
      console.error(`[extractProfileFromTranscript] Model ${model} threw:`, lastError);
      // For 404 errors (model not found), continue to next model
      if (!lastError.includes('gemini_http_404')) {
        throw e;
      }
    }
  }

  if (!data) {
    throw new Error(lastError || 'gemini_model_unavailable');
  }

  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) {
    throw new Error('gemini_empty_response');
  }

  const parsed = extractJsonObject(content);
  if (!parsed) {
    throw new Error(`gemini_invalid_json: ${String(content).slice(0, 140)}`);
  }

  const profile = validateProfile(parsed);
  if (includeDebug) {
    return {
      profile,
      model: selectedModel,
      context,
      prompt,
    };
  }

  return profile;
}

export async function upsertUserProfile(userId, profile, transcript) {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('user_profiles')
    .upsert(
      {
        user_id: userId,
        skills: profile.skills,
        experience: profile.experience,
        interests: profile.interests,
        work_type: profile.work_type,
        level: profile.level,
        raw_transcript: transcript,
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    throw new Error(`Supabase upsert failed: ${error.message}`);
  }
}

export async function upsertUserLocation(userId, location = {}) {
  const supabase = getSupabaseClient();

  const payload = {
    user_id: userId,
    city: String(location.city || '').trim(),
    country: String(location.country || '').trim(),
  };

  const { error } = await supabase
    .from('user_profiles')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    throw new Error(`Supabase location upsert failed: ${error.message}`);
  }
}
