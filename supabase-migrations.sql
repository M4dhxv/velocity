/**
 * Supabase Schema Migrations for Autofill
 * 
 * Run with: psql -h db.supabase.co -U postgres -d postgres -f migrations.sql
 * Or use Supabase SQL Editor to execute
 */

-- ============================================================
-- TABLE: autofill_jobs
-- Tracks all autofill job submissions
-- ============================================================

CREATE TABLE IF NOT EXISTS autofill_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  
  -- Job metadata
  company TEXT NOT NULL,
  role_title TEXT NOT NULL,
  job_url TEXT NOT NULL,
  domain TEXT NOT NULL, -- e.g., 'greenhouse.io', 'lever.co'
  
  -- Submission tracking
  status TEXT NOT NULL DEFAULT 'queued', -- queued, running, paused, completed, failed
  -- queued: waiting in BullMQ
  -- running: Playwright is filling form
  -- paused: waiting for HITL (CAPTCHA, blocked, etc)
  -- completed: successfully submitted
  -- failed: permanent failure
  
  idempotency_key TEXT NOT NULL UNIQUE, -- Prevent duplicate submissions
  bullmq_job_id TEXT, -- Reference to BullMQ job ID for correlation
  
  -- Execution details
  attempts_made INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  
  -- Delays & scheduling
  scheduled_delay_ms INT, -- Custom delay before apply
  randomized_delay_applied_ms INT, -- Actual delay used
  executed_at TIMESTAMP WITH TIME ZONE,
  
  -- Results
  result_screenshot_url TEXT, -- S3/R2 screenshot of completed form
  result_video_url TEXT, -- S3/R2 video recording of fill process
  error_message TEXT,
  error_stacktrace TEXT,
  
  -- HITL (Human-In-The-Loop)
  hitl_paused_at TIMESTAMP WITH TIME ZONE,
  hitl_reason TEXT, -- 'captcha', 'blocked', 'error', etc
  hitl_artifacts JSONB, -- { screenshot, logs, etc }
  
  -- Metadata & context
  evaluation_score NUMERIC(3,1), -- From career-ops evaluation (e.g., 4.8)
  report_id UUID, -- Link to career-ops report
  form_answers JSONB, -- Pre-filled answers { questionId: answer }
  resume_url TEXT, -- S3/R2 URL to resume file
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: autofill_rate_limits
-- Per-domain rate limit configuration & state
-- ============================================================

CREATE TABLE IF NOT EXISTS autofill_rate_limits (
  domain TEXT PRIMARY KEY,
  
  -- Configuration
  rps NUMERIC(5,2) NOT NULL, -- Requests per second
  burst_capacity INT NOT NULL, -- Max concurrent requests
  retry_after_ms INT NOT NULL, -- Suggested retry delay
  
  -- Current state
  current_tokens NUMERIC(10,4) DEFAULT 0,
  last_refill_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Adaptive throttling
  failure_count INT DEFAULT 0,
  throttle_multiplier NUMERIC(3,1) DEFAULT 1.0, -- 1.0 = normal, 2.0 = half speed
  
  -- Metadata
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default rate limits
INSERT INTO autofill_rate_limits (domain, rps, burst_capacity, retry_after_ms, notes)
VALUES 
  ('greenhouse.io', 0.2, 1, 5000, 'Conservative: 1 per 5s'),
  ('lever.co', 0.2, 1, 5000, 'Conservative: 1 per 5s'),
  ('ashby.com', 0.25, 1, 4000, 'Slightly faster: 1 per 4s'),
  ('workable.com', 0.33, 2, 3000, 'Slightly faster: ~1 per 3s'),
  ('bamboohr.com', 0.2, 1, 5000, 'Conservative: 1 per 5s'),
  ('taleo.net', 0.167, 1, 6000, 'Very conservative: 1 per 6s (Oracle backend)'),
  ('default', 0.1, 1, 10000, 'Fallback for unknown domains')
ON CONFLICT (domain) DO NOTHING;

-- ============================================================
-- TABLE: autofill_credits
-- Track free autofill credits per user
-- ============================================================

CREATE TABLE IF NOT EXISTS autofill_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Credit balance
  free_credits INT DEFAULT 3, -- Free applies per month
  purchased_credits INT DEFAULT 0,
  total_credits INT GENERATED ALWAYS AS (free_credits + purchased_credits) STORED,
  
  -- Usage
  used_credits INT DEFAULT 0,
  remaining_credits INT GENERATED ALWAYS AS (total_credits - used_credits) STORED,
  
  -- Tracking
  credits_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- Monthly reset
  last_apply_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: autofill_hitl_queue
-- Queue for human-in-the-loop resolution (CAPTCHA, blocks, etc)
-- ============================================================

CREATE TABLE IF NOT EXISTS autofill_hitl_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  autofill_job_id UUID NOT NULL REFERENCES autofill_jobs(id) ON DELETE CASCADE,
  
  -- HITL details
  reason TEXT NOT NULL, -- 'captcha', 'blocked_by_ip', 'rate_limited', 'error', 'other'
  description TEXT,
  artifacts JSONB, -- { screenshot_url, logs, etc }
  
  -- Status
  status TEXT DEFAULT 'pending', -- pending, resolved, dismissed, auto_resolved
  resolved_by UUID REFERENCES auth.users(id), -- Who resolved it
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,
  
  -- Auto-resolution
  auto_resolved BOOLEAN DEFAULT FALSE,
  auto_resolution_reason TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: autofill_domain_errors
-- Log errors per domain for monitoring & adaptive throttling
-- ============================================================

CREATE TABLE IF NOT EXISTS autofill_domain_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  
  error_type TEXT, -- 'network', 'captcha', 'rate_limit', 'element_not_found', etc
  error_message TEXT,
  
  count INT DEFAULT 1,
  last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update autofill_jobs.updated_at
CREATE OR REPLACE FUNCTION update_autofill_jobs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS autofill_jobs_timestamp ON autofill_jobs;
CREATE TRIGGER autofill_jobs_timestamp
BEFORE UPDATE ON autofill_jobs
FOR EACH ROW
EXECUTE FUNCTION update_autofill_jobs_timestamp();

-- Auto-deduct credits when job completes
CREATE OR REPLACE FUNCTION deduct_autofill_credits()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE autofill_credits
    SET used_credits = used_credits + 1,
        last_apply_at = NOW()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS autofill_deduct_credits ON autofill_jobs;
CREATE TRIGGER autofill_deduct_credits
AFTER UPDATE ON autofill_jobs
FOR EACH ROW
EXECUTE FUNCTION deduct_autofill_credits();

-- Reset monthly free credits (runs via pg_cron or manually)
CREATE OR REPLACE FUNCTION reset_monthly_free_credits()
RETURNS void AS $$
BEGIN
  UPDATE autofill_credits
  SET free_credits = 3,
      used_credits = 0,
      credits_reset_at = NOW()
  WHERE EXTRACT(MONTH FROM credits_reset_at) != EXTRACT(MONTH FROM NOW());
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- INDEXES for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_user_status 
  ON autofill_jobs(user_id, status);

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_user_id
  ON autofill_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_job_id
  ON autofill_jobs(job_id);

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_status
  ON autofill_jobs(status);

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_idempotency_key
  ON autofill_jobs(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_domain
  ON autofill_jobs(domain);

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_executed_at_desc
  ON autofill_jobs(executed_at DESC)
  WHERE executed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_domain_status 
  ON autofill_jobs(domain, status);

CREATE INDEX IF NOT EXISTS idx_autofill_jobs_created_at_desc 
  ON autofill_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autofill_credits_remaining 
  ON autofill_credits(remaining_credits) 
  WHERE remaining_credits > 0;

CREATE INDEX IF NOT EXISTS idx_autofill_hitl_job_id
  ON autofill_hitl_queue(autofill_job_id);

CREATE INDEX IF NOT EXISTS idx_autofill_hitl_status
  ON autofill_hitl_queue(status);

CREATE INDEX IF NOT EXISTS idx_autofill_hitl_created_at_desc
  ON autofill_hitl_queue(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autofill_domain_errors_domain
  ON autofill_domain_errors(domain);

CREATE INDEX IF NOT EXISTS idx_autofill_domain_errors_type
  ON autofill_domain_errors(error_type);

CREATE INDEX IF NOT EXISTS idx_autofill_domain_errors_last_seen_desc
  ON autofill_domain_errors(last_seen DESC);

-- ============================================================
-- RLS (Row-Level Security)
-- ============================================================

ALTER TABLE autofill_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE autofill_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE autofill_hitl_queue ENABLE ROW LEVEL SECURITY;

-- Users can only view their own jobs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'autofill_jobs'
      AND policyname = 'autofill_jobs_user_access'
  ) THEN
    CREATE POLICY autofill_jobs_user_access
      ON autofill_jobs
      FOR ALL
      USING (auth.uid() = user_id OR auth.role() = 'service_role');
  END IF;
END
$$;

-- Users can only view their own credits
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'autofill_credits'
      AND policyname = 'autofill_credits_user_access'
  ) THEN
    CREATE POLICY autofill_credits_user_access
      ON autofill_credits
      FOR ALL
      USING (auth.uid() = user_id OR auth.role() = 'service_role');
  END IF;
END
$$;

-- Users can only view HITL items for their jobs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'autofill_hitl_queue'
      AND policyname = 'autofill_hitl_queue_user_access'
  ) THEN
    CREATE POLICY autofill_hitl_queue_user_access
      ON autofill_hitl_queue
      FOR ALL
      USING (
        autofill_job_id IN (
          SELECT id FROM autofill_jobs 
          WHERE user_id = auth.uid()
        ) OR auth.role() = 'service_role'
      );
  END IF;
END
$$;
