# Deploy Autofill Worker on Heroku

## Quick Start

### 1. Install Heroku CLI
```bash
brew install heroku/brew/heroku
heroku login
```

### 2. Create Heroku App
```bash
cd /path/to/giggrab_website
heroku create giggrab-autofill-worker
```

### 3. Add Redis Add-on
```bash
heroku addons:create heroku-redis:mini
# Copy REDIS_URL from output
```

### 4. Set Environment Variables
```bash
heroku config:set SUPABASE_URL="https://xgqzuxosnypqohkqmkit.supabase.co"
heroku config:set SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhncXp1eG9zbnlwcW9oa3Fta2l0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMjUxMiwiZXhwIjoyMDkyMTc4NTEyfQ.s_uaAKHgadAwHSZjcEpClQKMmfvTwc6iGomIx_oqKbg"
heroku config:set WORKER_CONCURRENCY=3
# Redis URL is auto-set by the add-on as REDIS_URL
```

### 5. Deploy from Git
```bash
git push heroku main
# Or: git push heroku master (if using master branch)
```

### 6. Scale Worker Dyno
```bash
heroku ps:scale worker=1
```

### 7. Check Logs
```bash
heroku logs --tail
```

Look for:
```
[STARTUP] Autofill Worker started (concurrency: 3)
```

---

## Verify It's Running

```bash
heroku ps
# Should show:
# worker.1: up (running for 2m)
```

Check job processing:
```bash
heroku logs --source worker
```

---

## Pricing

| Component | Cost/month |
|-----------|-----------|
| Eco dyno (worker) | $5 |
| Redis mini | $5 |
| **Total** | **~$10/mo** |

---

## Troubleshooting

### Worker won't start
```bash
heroku logs --tail
```
Common issues:
- Missing `REDIS_URL` - verify with `heroku config`
- Missing Supabase key - check config vars
- Node version mismatch - check `package.json` engines

### Restart worker
```bash
heroku ps:restart worker
```

### View specific logs
```bash
heroku logs --tail --source worker --dyno worker.1
```

---

## Connect to Redis (optional debugging)
```bash
heroku redis:cli
# Then: INFO or KEYS *
```

---

## Deploy Updates
When you push changes to GitHub/main:
```bash
git push heroku main
```

Heroku auto-rebuilds and restarts the worker.

---

## Scale Up (for production)
Increase concurrency:
```bash
heroku config:set WORKER_CONCURRENCY=5
heroku ps:restart worker
```

Or upgrade Redis:
```bash
heroku addons:upgrade heroku-redis:premium-0
```
