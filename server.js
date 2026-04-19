import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  buildGreetingText,
  extractProfileFromTranscript,
  getConfig,
  synthesizeSpeech,
  transcribeAudio,
  upsertUserProfile,
} from './lib/onboarding.js';

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

app.post('/api/onboard/respond', async (req, res) => {
  try {
    const { user_id: userId, audio_base64: audioBase64 } = req.body || {};

    if (!userId || !audioBase64 || typeof userId !== 'string' || typeof audioBase64 !== 'string') {
      return res.status(400).json({ success: false, message: 'invalid_input' });
    }

    // 1) STT
    const transcript = await transcribeAudio(audioBase64);
    if (!transcript) {
      return res.json({ success: false, message: 'transcription_failed' });
    }

    // 2) LLM (single call) + 3) validation
    const profile = await extractProfileFromTranscript(transcript);

    // 4) save profile
    await upsertUserProfile(userId, profile, transcript);

    // 5) TTS responses (post-save)
    const ackText = 'Got it. Setting up your profile.';
    const successText = 'Your profile is ready.';

    const ackAudio = await synthesizeSpeech(ackText);
    const successAudio = await synthesizeSpeech(successText);

    return res.json({
      success: true,
      ack_audio_base64: ackAudio,
      success_audio_base64: successAudio,
      profile,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'respond_failed' });
  }
});

app.listen(port, () => {
  console.log(`Voice onboarding backend listening on port ${port}`);
});
