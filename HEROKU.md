# Deploying the worker to Heroku (hybrid Vercel + Heroku setup)

This project keeps the serverless APIs on Vercel and runs the long-running BullMQ worker on Heroku.

Prereqs:
- Heroku CLI installed and logged in
- A Heroku app (or permission to create one)
- Redis (Heroku Redis addon or external Redis) for BullMQ
- Required env vars: `REDIS_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (if needed), any storage credentials

1) Create the Heroku app

```bash
heroku create my-giggrab-worker
```

2) Add Redis (example using Heroku Redis hobby)

```bash
heroku addons:create heroku-redis:hobby-dev --app my-giggrab-worker
# wait for the addon to provision, then inspect config:
heroku config:get REDIS_URL --app my-giggrab-worker
```

3) Set required config vars

```bash
heroku config:set REDIS_URL="redis://..." \
  SUPABASE_URL="https://your-project.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  SUPABASE_ANON_KEY="your-anon-key" \
  --app my-giggrab-worker
```

4) Procfile

This repo includes a `Procfile` which runs the worker dyno using the npm script `worker:autofill`:

```
worker: npm run worker:autofill
```

5) Deploy

Option A — Deploy via Git (simple):

```bash
git push https://git.heroku.com/my-giggrab-worker.git main
```

Option B — Deploy with Docker (if you add a `Dockerfile`):

```bash
heroku container:push worker --app my-giggrab-worker
heroku container:release worker --app my-giggrab-worker
```

6) Scale the worker dyno (Hobby or above recommended for always-on processing)

```bash
# enable one worker dyno
heroku ps:scale worker=1 --app my-giggrab-worker
```

7) View logs

```bash
heroku logs --tail --app my-giggrab-worker
```

Notes / Recommendations:
- Your Heroku $13 plan (Hobby) supports worker dynos but does not autoscale; ensure the dyno is used for background processing and that you pick a Redis plan appropriate for persistence/load.
- For production-grade reliability consider a managed Redis (e.g., Redis Cloud) or bump Heroku Redis plan.
- Keep Vercel for serverless APIs and front-end; only run the long-running worker and any tasks Vercel cannot handle on Heroku.
