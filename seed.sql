-- ═══════════════════════════════════════════════════════════════
-- GigGrab — core schema for onboarding + ingested jobs
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- 1) Jobs table used by Apify ingestion pipeline
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  skills TEXT[] NOT NULL DEFAULT '{}',
  category TEXT NOT NULL DEFAULT 'general',
  type TEXT NOT NULL CHECK (type IN ('remote', 'local')),
  job_type TEXT NOT NULL CHECK (job_type IN ('freelance', 'contract')),
  budget NUMERIC,
  hourly_rate_min NUMERIC,
  hourly_rate_max NUMERIC,
  currency TEXT NOT NULL DEFAULT 'USD',
  location TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  client_verified BOOLEAN NOT NULL DEFAULT false,
  posted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Required for ON CONFLICT (source, source_id) upsert.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_source_id_uniq
  ON jobs (source, source_id);

-- 2) Indexing for fast matching / filtering
CREATE INDEX IF NOT EXISTS jobs_skills_gin_idx
  ON jobs USING GIN (skills);

CREATE INDEX IF NOT EXISTS jobs_category_idx
  ON jobs (category);

CREATE INDEX IF NOT EXISTS jobs_type_idx
  ON jobs (type);

CREATE INDEX IF NOT EXISTS jobs_posted_at_idx
  ON jobs (posted_at DESC);

-- 3) RLS (public read)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'jobs'
      AND policyname = 'Anyone can read jobs'
  ) THEN
    CREATE POLICY "Anyone can read jobs"
      ON jobs
      FOR SELECT
      USING (true);
  END IF;
END
$$;

-- 4) Optional baseline jobs (safe to rerun)
INSERT INTO jobs (
  title,
  description,
  skills,
  category,
  type,
  job_type,
  budget,
  hourly_rate_min,
  hourly_rate_max,
  currency,
  location,
  source,
  source_id,
  source_url,
  client_verified,
  posted_at
)
VALUES
  (
    'React landing page cleanup',
    'Need React + CSS fixes for a SaaS landing page. Remote role, quick turnaround.',
    ARRAY['react', 'javascript', 'css', 'html'],
    'frontend',
    'remote',
    'contract',
    250,
    NULL,
    NULL,
    'USD',
    'Anywhere',
    'seed',
    'seed-001',
    'https://example.com/jobs/seed-001',
    true,
    NOW() - INTERVAL '2 hours'
  ),
  (
    'Node API integration support',
    'Backend contract to integrate third-party APIs and improve service reliability.',
    ARRAY['node', 'api'],
    'backend',
    'remote',
    'contract',
    NULL,
    30,
    45,
    'USD',
    'Anywhere',
    'seed',
    'seed-002',
    'https://example.com/jobs/seed-002',
    true,
    NOW() - INTERVAL '4 hours'
  ),
  (
    'Figma UI refresh for café app',
    'Freelance local project to redesign key app screens in Figma for a neighborhood café.',
    ARRAY['figma', 'ui', 'ux'],
    'design',
    'local',
    'freelance',
    400,
    NULL,
    NULL,
    'USD',
    'Austin, TX',
    'seed',
    'seed-003',
    'https://example.com/jobs/seed-003',
    false,
    NOW() - INTERVAL '1 day'
  )
ON CONFLICT (source, source_id) DO NOTHING;

-- 5) Voice onboarding profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  experience TEXT NOT NULL DEFAULT '',
  interests JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_type TEXT NOT NULL DEFAULT 'any',
  level TEXT NOT NULL DEFAULT 'intermediate',
  raw_transcript TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_profiles_work_type_check CHECK (work_type IN ('remote', 'local', 'part-time', 'full-time', 'any')),
  CONSTRAINT user_profiles_level_check CHECK (level IN ('beginner', 'intermediate', 'advanced'))
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
