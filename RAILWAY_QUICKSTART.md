# Quick Deploy on Railway (Fastest)

## 1. Push to GitHub
```bash
git add .
git commit -m "Add autofill worker and deployment config"
git push
```

## 2. Go to Railway.app
- Sign up: https://railway.app
- Click "New Project"
- Select "Deploy from GitHub"
- Choose your repo

## 3. In Railway Dashboard
- Click "Add Service"
- Search for "Redis"
- Add Redis to project

## 4. Configure Node Service
- Go to Variables tab
- Add:
```
SUPABASE_URL=https://xgqzuxosnypqohkqmkit.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhncXp1eG9zbnlwcW9oa3Fta2l0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMjUxMiwiZXhwIjoyMDkyMTc4NTEyfQ.s_uaAKHgadAwHSZjcEpClQKMmfvTwc6iGomIx_oqKbg
REDIS_URL=${{Redis.REDIS_URL}}
WORKER_CONCURRENCY=3
```

## 5. Set Start Command
In "Settings" tab:
```
Start Command: node workers/autofill-processor.js
```

## 6. Deploy
Click "Deploy" - it will build and start automatically!

---

## Check it's Running
```bash
railway logs
```

Look for:
```
[STARTUP] Autofill Worker started (concurrency: 3)
```

Done! Your worker is live and processing autofill jobs.
