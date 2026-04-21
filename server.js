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
    const name = String(req.body?.user_name || 'there').trim();
    const fallbackText = `Hey ${name}, nice to meet you. Tell me your top skills and what work you want.`;
    const text = String(req.body?.text || fallbackText).trim().slice(0, 180);
    if (!text) return res.status(400).json({ success: false, message: 'invalid_text' });

    const audioBase64 = await synthesizeSpeech(text, {
      languageCode: 'en-US',
      voiceName: 'en-US-Neural2-C',
      speakingRate: 1.02,
    });

    return res.status(200).json({ success: true, audio_base64: audioBase64 });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'tts_failed' });
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
