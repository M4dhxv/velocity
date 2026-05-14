-- Autofill schema for Supabase live project
-- Paste this into Supabase SQL editor if the autofill tables are missing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLE: autofill_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS autofill_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  role_title TEXT NOT NULL,
  job_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL UNIQUE,
  bullmq_job_id TEXT,
  attempts_made INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  scheduled_delay_ms INT,
  randomized_delay_applied_ms INT,
  executed_at TIMESTAMP WITH TIME ZONE,
  result_screenshot_url TEXT,
  result_video_url TEXT,
  error_message TEXT,
  error_stacktrace TEXT,
  hitl_paused_at TIMESTAMP WITH TIME ZONE,
  hitl_reason TEXT,
  hitl_artifacts JSONB,
  evaluation_score NUMERIC(3,1),
  report_id UUID,
  form_answers JSONB,
  resume_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: autofill_rate_limits
-- ============================================================
CREATE TABLE IF NOT EXISTS autofill_rate_limits (
  domain TEXT PRIMARY KEY,
  rps NUMERIC(5,2) NOT NULL,
  burst_capacity INT NOT NULL,
  retry_after_ms INT NOT NULL,
  current_tokens NUMERIC(10,4) DEFAULT 0,
  last_refill_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  failure_count INT DEFAULT 0,
  throttle_multiplier NUMERIC(3,1) DEFAULT 1.0,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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
-- ============================================================
CREATE TABLE IF NOT EXISTS autofill_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  free_credits INT DEFAULT 3,
  purchased_credits INT DEFAULT 0,
  total_credits INT GENERATED ALWAYS AS (free_credits + purchased_credits) STORED,
  used_credits INT DEFAULT 0,
  remaining_credits INT GENERATED ALWAYS AS (free_credits + purchased_credits - used_credits) STORED,
  credits_reset_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_apply_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: autofill_hitl_queue
-- ============================================================
CREATE TABLE IF NOT EXISTS autofill_hitl_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  autofill_job_id UUID NOT NULL REFERENCES autofill_jobs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  description TEXT,
  artifacts JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLE: autofill_domain_errors
-- ============================================================
CREATE TABLE IF NOT EXISTS autofill_domain_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TRIGGERS / FUNCTIONS
-- ============================================================
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
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_user_status ON autofill_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_user_id ON autofill_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_job_id ON autofill_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_status ON autofill_jobs(status);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_idempotency_key ON autofill_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_domain ON autofill_jobs(domain);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_executed_at_desc ON autofill_jobs(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_domain_status ON autofill_jobs(domain, status);
CREATE INDEX IF NOT EXISTS idx_autofill_jobs_created_at_desc ON autofill_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autofill_credits_remaining ON autofill_credits(remaining_credits) WHERE remaining_credits > 0;
CREATE INDEX IF NOT EXISTS idx_autofill_hitl_queue_created_at_desc ON autofill_hitl_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autofill_domain_errors_created_at_desc ON autofill_domain_errors(created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE autofill_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE autofill_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE autofill_hitl_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE autofill_domain_errors ENABLE ROW LEVEL SECURITY;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'autofill_domain_errors'
      AND policyname = 'autofill_domain_errors_service_access'
  ) THEN
    CREATE POLICY autofill_domain_errors_service_access
      ON autofill_domain_errors
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END
$$;
