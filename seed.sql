-- ═══════════════════════════════════════════════════════════════
-- GigGrab — jobs table + seed data
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- 1. Create table
CREATE TABLE IF NOT EXISTS jobs (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title     TEXT NOT NULL,
  skills    TEXT[] NOT NULL DEFAULT '{}',
  type      TEXT NOT NULL CHECK (type IN ('remote','local','quick')),
  pay       INT NOT NULL,
  location  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable Row Level Security (read-only for anon)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read jobs" ON jobs FOR SELECT USING (true);

-- 3. Seed 25 gigs
INSERT INTO jobs (title, skills, type, pay, location) VALUES
  -- REMOTE
  ('Frontend bug fixes — React app',              ARRAY['frontend','react','javascript','css'],              'remote', 50,  NULL),
  ('Translate product listings EN → ES',           ARRAY['translation','spanish','writing'],                  'remote', 28,  NULL),
  ('Write 5 SEO blog posts (tech niche)',          ARRAY['writing','seo','content','blogging'],               'remote', 90,  NULL),
  ('Design landing page in Figma',                 ARRAY['design','figma','ui','ux'],                         'remote', 75,  NULL),
  ('Build email template (HTML/CSS)',              ARRAY['frontend','html','css','email'],                    'remote', 35,  NULL),
  ('Data entry — 200 product rows',                ARRAY['data-entry','spreadsheet','typing'],                'remote', 22,  NULL),
  ('AI image labeling — classification',           ARRAY['data-labeling','ai','annotation'],                  'remote', 18,  NULL),
  ('Transcribe 20-min podcast episode',            ARRAY['transcription','typing','audio'],                   'remote', 24,  NULL),
  ('Social media captions — 30 posts',             ARRAY['writing','social-media','content','copywriting'],   'remote', 40,  NULL),
  ('Python script to scrape product prices',       ARRAY['python','scraping','backend','automation'],         'remote', 65,  NULL),

  -- LOCAL
  ('Shoot content for local café',                 ARRAY['photography','video','content','social-media'],     'local',  45,  'Brooklyn, NY'),
  ('Mystery shopper — Electronics store',          ARRAY['mystery-shopping','review','retail'],               'local',  32,  'Manhattan, NY'),
  ('Event-day package runner — Downtown',          ARRAY['delivery','driving','logistics'],                   'local',  60,  'Downtown LA'),
  ('Product photography — home studio',            ARRAY['photography','product','studio'],                   'local',  55,  'Austin, TX'),
  ('Flyer distribution — 500 flyers',             ARRAY['marketing','distribution','walking'],               'local',  25,  'Chicago, IL'),
  ('Pop-up event setup — furniture move',          ARRAY['event','setup','lifting','labor'],                  'local',  70,  'San Francisco, CA'),
  ('Grocery delivery — 3 drops',                   ARRAY['delivery','driving','grocery'],                     'local',  27,  'Miami, FL'),

  -- QUICK
  ('Test new app — write review',                  ARRAY['testing','review','app','feedback'],                'quick',  15,  NULL),
  ('Voice-over 60s commercial script',             ARRAY['voice-over','audio','speaking','acting'],           'quick',  35,  NULL),
  ('Quick survey — 10 minutes',                    ARRAY['survey','feedback','data-entry'],                   'quick',  8,   NULL),
  ('Proofread 2-page document',                    ARRAY['proofreading','writing','editing'],                 'quick',  12,  NULL),
  ('Record 5 short TikTok clips',                  ARRAY['video','tiktok','content','social-media'],          'quick',  30,  NULL),
  ('Custom logo sketch — small café',             ARRAY['design','logo','illustration','branding'],           'quick',  80,  NULL),
  ('Fill out 3 online forms',                      ARRAY['data-entry','typing','admin'],                      'quick',  10,  NULL),
  ('Phone call — confirm 10 appointments',         ARRAY['calling','phone','admin','customer-service'],       'quick',  20,  NULL);

-- 4. Voice onboarding profiles table
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
  CONSTRAINT user_profiles_work_type_check CHECK (work_type IN ('remote','local','part-time','full-time','any')),
  CONSTRAINT user_profiles_level_check CHECK (level IN ('beginner','intermediate','advanced'))
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
