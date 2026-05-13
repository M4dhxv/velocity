# GigGrab Autofill Job Board - Setup & Usage

## Overview

The autofill infrastructure is now **fully deployed**:

- **Frontend**: Job board at `/autofill-jobs.html` (on your Vercel domain)
- **Backend APIs**: 
  - `POST /api/autofill` → Enqueue jobs for autofill (merged handler)
  - `GET /api/jobs` → Fetch jobs with optional filtering
- **Worker**: Heroku dyno consuming BullMQ queue and processing applications

---

## Quick Start

### 1. Populate the Database with Real Jobs

Run the job insertion script (requires `SUPABASE_SERVICE_ROLE_KEY`):

```bash
# Set the key in your environment or .env
export SUPABASE_SERVICE_ROLE_KEY="your-key-here"

# Insert Lever jobs (Stripe, Retool, Vercel)
node scripts/insert-lever-jobs.js
```

Alternatively, use fallback sample jobs (auto-triggered if the API fails).

### 2. Access the Job Board

Visit your deployed website:

```
https://your-vercel-domain.com/autofill-jobs.html
```

The page will:
- Fetch jobs from the database
- Filter for frontend web dev roles
- Display them in a beautiful grid
- Allow you to click "Apply Now" to submit applications

### 3. Apply to a Job

1. Click **"Apply Now"** on any job
2. Fill in your details:
   - First Name, Last Name, Email, Phone
   - Resume URL (link to your PDF or file)
   - **JWT Token** (your Supabase auth token)
3. Click **"Submit Application"**
4. The job is enqueued to BullMQ and will be processed by the Heroku worker

### 4. Check Job Status (Optional)

You can check the status of submitted jobs via the API:

```bash
curl -X GET "https://your-vercel-domain.com/api/autofill?jobId=<bullmq_job_id>" \
  -H "Authorization: Bearer <your-jwt-token>"
```

---

## How It Works End-to-End

```
┌─────────────────┐
│  User visits    │
│  /autofill-     │
│  jobs.html      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ GET /api/jobs               │
│ (Fetch from Supabase)       │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ User selects job,           │
│ clicks "Apply Now"          │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ POST /api/autofill              │
│ (Merged handler: enqueue.js +   │
│  status.js + cancel.js)         │
└────────┬────────────────────────┘
         │ (creates BullMQ job)
         │
┌────────▼────────────────────┐
│ BullMQ Job Queue (Redis)    │
│ (on Heroku)                 │
└────────┬────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ Heroku Worker               │
│ (workers/autofill-         │
│  processor.js)              │
│                             │
│ - Acquire concurrency slot  │
│ - Check rate limits         │
│ - Wait (humanize delay)     │
│ - Mock Playwright fill      │
│ - Update Supabase           │
└─────────────────────────────┘
```

---

## Environment Variables (Vercel / Heroku)

### Vercel

```
SUPABASE_URL=https://xgqzuxosnypqohkqmkit.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>  # Optional, for server-side only
```

### Heroku (velocity-88)

```
REDIS_URL=<auto-set by Heroku Redis addon>
SUPABASE_URL=https://xgqzuxosnypqohkqmkit.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
NODE_ENV=production
WORKER_CONCURRENCY=5
```

---

## Testing Locally

### 1. Start Redis (if not using Heroku)

```bash
redis-server
```

### 2. Start Vercel dev server

```bash
vercel dev
```

### 3. Start the worker

```bash
npm run worker:autofill
```

### 4. Open the test page

```
http://localhost:3000/autofill-jobs.html
```

---

## Troubleshooting

### "Jobs not loading"
- Check that `/api/jobs` returns data: `curl http://localhost:3000/api/jobs`
- Ensure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set

### "Unauthorized" when applying
- Get a valid JWT token from Supabase auth
- Make sure your user has credits in `autofill_credits` table

### "Worker not processing"
- Check Heroku logs: `heroku logs --tail --app velocity-88`
- Ensure Redis is running and `REDIS_URL` is set correctly

---

## Next Steps

1. **Implement real Playwright autofill**: Replace the mock in `workers/autofill-processor.js` with actual form filling logic
2. **Add artifact storage**: Upload screenshots/videos to S3 or R2
3. **Build HITL UI**: Create a dashboard for resolving CAPTCHA and blocked applications
4. **Add monitoring**: Integrate Sentry or Datadog for error tracking

---

## Files

- `autofill-jobs.html` - Main job board frontend
- `autofill-test.html` - Standalone test page (legacy)
- `api/autofill/index.js` - Merged autofill API handler (enqueue + status + cancel)
- `api/jobs.js` - Jobs listing API
- `workers/autofill-processor.js` - BullMQ worker (runs on Heroku)
- `lib/autofill-queue.js` - Queue helpers
- `lib/rate-limiter.js` - Rate limiting logic
- `scripts/insert-lever-jobs.js` - Fetch & insert real jobs
- `Procfile` - Heroku worker configuration
- `HEROKU.md` - Heroku deployment guide
