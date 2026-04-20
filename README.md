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
- `APIFY_TOKEN`
- `APIFY_UPWORK_ACTOR_ID`
- `APIFY_LINKEDIN_ACTOR_ID`
- `APIFY_USE_STORED_RUNS` (optional; import latest successful run datasets)
- `APIFY_UPWORK_DATASET_IDS` (optional; comma/JSON list)
- `APIFY_LINKEDIN_DATASET_IDS` (optional; comma/JSON list)
- `APIFY_UPWORK_INPUT` (optional JSON string)
- `APIFY_LINKEDIN_INPUT` (optional JSON string)
- `APIFY_UPWORK_TARGETS` (optional JSON array of `{query,limit}`)
- `APIFY_UPWORK_QUERY_FIELD` (optional; default `query`)
- `APIFY_UPWORK_LIMIT_FIELD` (optional; default `maxItems`)
- `CRON_SECRET` (recommended; protects ingestion endpoint)
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
- [api/jobs/ingest.js](api/jobs/ingest.js)

Runtime config is in [vercel.json](vercel.json).

## Apify Job Ingestion Pipeline

Implemented flow:
1. Trigger actor runs on Apify (Upwork + LinkedIn).
2. Wait for run completion.
3. Fetch dataset items (`clean=true`).
4. Normalize to a unified `jobs` shape.
5. Upsert into Supabase via conflict key `(source, source_id)`.

If free-tier run limits are reached, you can still import existing Apify storage:
- set `APIFY_USE_STORED_RUNS=true` to pull the latest successful datasets, or
- provide explicit dataset IDs via `APIFY_UPWORK_DATASET_IDS` / `APIFY_LINKEDIN_DATASET_IDS`, or
- send `upwork_dataset_ids` / `linkedin_dataset_ids` to `POST /api/jobs/ingest`.

Upwork extraction supports multi-run keyword targeting. Built-in defaults include:
- frontend developer (20), react developer (20), web developer (20), python developer (10), bug fixing (10)
- graphic designer (20), logo design (10), video editor (15), ui ux designer (10), thumbnail designer (5)
- content writer (20), blog writer (10), copywriting (10), ghostwriting (5)
- social media manager (15), instagram marketing (10), seo (10), email marketing (5)
- data entry (15), virtual assistant (15), online research (5), simple tasks (5)

Override via request body: `upwork_targets: [{"query":"...","limit":10}]`.

Normalization includes:
- title/description cleanup + trim
- skill extraction via keyword dictionary (no LLM)
- category/type/job_type detection
- duplicate removal before upsert
- description max length: 1000 chars

### Trigger ingestion

- Vercel cron: runs daily (03:00 UTC) via [vercel.json](vercel.json)
- Manual (local):

```bash
npm run ingest:jobs
```

- Manual (API):
  - `GET /api/jobs/ingest` (cron-friendly)
  - `POST /api/jobs/ingest` (optional input overrides)

If `CRON_SECRET` is set, send `Authorization: Bearer <CRON_SECRET>`.

## Local Run (optional)

You can run as a local Express server too:

```bash
npm install
npm run dev
```

Local routes are defined in [server.js](server.js).

## Quick Test

Use documentation in [docs/VOICE_ONBOARDING_API.md](docs/VOICE_ONBOARDING_API.md).
