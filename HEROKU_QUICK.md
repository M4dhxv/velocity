# Heroku + Supabase + Autofill Cheat Sheet

## 1-Minute Setup
```bash
# Login
heroku login

# Create app
heroku create giggrab-autofill-worker

# Add Redis
heroku addons:create heroku-redis:mini

# Set Supabase keys
heroku config:set SUPABASE_URL="https://xgqzuxosnypqohkqmkit.supabase.co"
heroku config:set SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhncXp1eG9zbnlwcW9oa3Fta2l0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMjUxMiwiZXhwIjoyMDkyMTc4NTEyfQ.s_uaAKHgadAwHSZjcEpClQKMmfvTwc6iGomIx_oqKbg"
heroku config:set WORKER_CONCURRENCY=3

# Deploy
git push heroku main

# Start worker
heroku ps:scale worker=1

# Check logs
heroku logs --tail
```

That's it. Worker is live.

---

## Monitor
```bash
heroku ps                    # See running dyno
heroku logs --tail          # Live logs
heroku config               # Check env vars
heroku addons               # See Redis addon
```

---

## Cost
- Eco dyno (worker): $5/mo
- Redis mini: $5/mo
- **Total: $10/mo**

---

## Test It
On live UI, click "Apply" on a job. Check logs:
```bash
heroku logs --tail
```

Should see:
```
[queued] Job 123 queued
[completed] Job 123 completed
```
