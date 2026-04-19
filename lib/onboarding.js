import { createClient } from '@supabase/supabase-js';

const VALID_WORK_TYPES = new Set(['remote', 'local', 'part-time', 'full-time', 'any']);
const VALID_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

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
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    supabaseUrl: requiredEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

let cachedSupabase = null;
export function getSupabaseClient() {
  if (cachedSupabase) return cachedSupabase;

  const { supabaseUrl, supabaseServiceRoleKey } = getConfig();
  cachedSupabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedSupabase;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
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
  const skills = cleanStringArray(candidate.skills);
  const interests = cleanStringArray(candidate.interests);

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

export async function synthesizeSpeech(text) {
  const { googleApiKey } = getConfig();

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${googleApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Neural2-F',
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`TTS failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.audioContent || '';
}

export async function transcribeAudio(audioBase64) {
  const { googleApiKey } = getConfig();

  const response = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${googleApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
        },
        audio: {
          content: audioBase64,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`STT failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data?.results?.[0]?.alternatives?.[0]?.transcript?.trim() || '';
}

export async function extractProfileFromTranscript(transcript) {
  const { geminiApiKey, geminiModel } = getConfig();

  const prompt = `Return ONLY valid JSON.\n\nExtract detailed structured profile from this text:\n"${transcript}"\n\nSTRICT RULES:\n- DO NOT default to generic skills like "communication"\n- Extract ACTUAL mentioned skills (e.g. react, python, sales, video editing)\n- If tech stack is mentioned, include it in skills\n- If nothing is found, return empty arrays (not generic values)\n- No markdown, no explanation, JSON only\n\nReturn exactly:\n{\n  "skills": [],\n  "experience": "",\n  "interests": [],\n  "work_type": "",\n  "level": ""\n}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'You extract concise structured onboarding profiles. Output JSON only.' }],
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
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM failed: ${response.status} ${err}`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = extractJsonObject(content) || {};
  return validateProfile(parsed);
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
