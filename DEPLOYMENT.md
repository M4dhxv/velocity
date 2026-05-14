# Autofill Worker Deployment Guide

## Option 1: Deploy on Fly.io (Recommended)

### 1. Install Fly CLI
```bash
curl -L https://fly.io/install.sh | sh
flyctl auth login
```

### 2. Create Fly Redis Database
```bash
flyctl redis create --region sjc
# Copy the Redis URL from output
```

### 3. Update fly.toml with Redis URL
Edit `fly.toml` and replace `REDIS_URL` with the connection string from step 2.

### 4. Deploy Worker
```bash
flyctl launch
flyctl deploy
```

### 5. Monitor Logs
```bash
flyctl logs
```

---

## Option 2: Deploy on Railway.app (Even Easier)

### 1. Install Railway CLI
```bash
npm i -g @railway/cli
railway login
```

### 2. Create Railway Project
```bash
railway init
railway up
```

### 3. Add Redis Service
```bash
railway add  # Select Redis
railway link redis  # Link to project
```

### 4. Deploy
```bash
railway up
```

---

## Option 3: Deploy on Render.com

### 1. Connect GitHub repo to Render.com

### 2. Create New Web Service
- Name: `giggrab-autofill-worker`
- Environment: Node
- Build command: `npm install`
- Start command: `node workers/autofill-processor.js`
- Plan: Standard (or Starter for free)

### 3. Add Environment Variables in Render Dashboard
```
SUPABASE_URL=https://xgqzuxosnypqohkqmkit.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_key_here
REDIS_URL=redis://...
WORKER_CONCURRENCY=3
```

### 4. Add Redis
- Create Render Redis instance
- Link connection string to `REDIS_URL`

### 5. Deploy from GitHub

---

## Environment Variables Needed

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | `https://xgqzuxosnypqohkqmkit.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key |
| `REDIS_URL` | Redis connection from database |
| `WORKER_CONCURRENCY` | `3` (or higher) |

---

## Verify Worker is Running

Once deployed, check logs for:
```
[STARTUP] Autofill Worker started (concurrency: 3)
```

If you see this, the worker is live and processing queued autofill jobs!

---

## Cost Estimate

| Platform | Cost | Notes |
|----------|------|-------|
| Fly.io | ~$10-15/mo | 1 shared-cpu-1x instance + Redis |
| Railway | ~$5-20/mo | Pay-as-you-go, generous free tier |
| Render | ~$7/mo | Starter tier, auto-sleep (may pause) |

---

## Next Steps

1. Deploy using one of the options above
2. Add `REDIS_URL` to environment
3. Verify worker logs show startup message
4. Test on live: trigger autofill from UI
5. Check `autofill_jobs` table for status updates

---

## Troubleshooting

**Worker won't start:**
- Check `REDIS_URL` is correct
- Verify Supabase keys have service_role
- Check logs: `flyctl logs` or equivalent

**Playwright timeout:**
- Increase timeout in `executePlaywrightFill()` (worker line ~260)
- Reduce concurrency if hitting memory limits

**Jobs stuck in "queued":**
- Worker crashed, check logs
- Redis connection lost, restart worker
