# GigGrab Voice Onboarding Backend (Vercel Ready)

Backend-only implementation for voice onboarding orchestration.

Flow:

1. `/api/onboard/start` → greeting TTS
2. `/api/onboard/respond` → STT → Gemini extraction (single call) → Supabase upsert → ack TTS + success TTS

## Endpoints

### GET `/api/onboard/start?user_name=STRING`
Returns greeting audio as base64.

Response:

```json
{
  "audio_base64": "string"
}
```

### POST `/api/onboard/respond`
Request:

```json
{
  "user_id": "string",
  "audio_base64": "string"
}
```

`audio_base64` must be WebM Opus at 48kHz.

Response (success):

```json
{
  "success": true,
  "ack_audio_base64": "string",
  "success_audio_base64": "string",
  "profile": {
    "skills": [],
    "experience": "",
    "interests": [],
    "work_type": "",
    "level": ""
  }
}
```

Response (no transcript):

```json
{
  "success": false,
  "message": "transcription_failed"
}
```

## Environment Variables

Create `.env` locally (Vercel uses Project Environment Variables):

- `GOOGLE_API_KEY` (used for Google STT + Google TTS)
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (default: `gemini-2.0-flash`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PORT` (local only)

Reference template: [.env.example](.env.example)

## Database Setup (Supabase)

Run [seed.sql](seed.sql) in Supabase SQL editor.

It creates:
- `jobs`
- `user_profiles` (required for onboarding)

## Deploy to Vercel

1. Push this project to GitHub.
2. Import repo in Vercel.
3. Add environment variables in Vercel Project Settings.
4. Deploy.

Vercel routes used:
- [api/onboard/start.js](api/onboard/start.js)
- [api/onboard/respond.js](api/onboard/respond.js)

Runtime config is in [vercel.json](vercel.json).

## Local Run (optional)

You can run as a local Express server too:

```bash
npm install
npm run dev
```

Local routes are defined in [server.js](server.js).

## Quick Test

Use documentation in [docs/VOICE_ONBOARDING_API.md](docs/VOICE_ONBOARDING_API.md).
