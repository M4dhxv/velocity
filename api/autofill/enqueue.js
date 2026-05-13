/**
 * POST /api/autofill/enqueue
 * 
 * Enqueue a job application for autofill
 * 
 * Validates:
 * - User has remaining credits
 * - Job hasn't been applied yet (idempotency)
 * - Rate limit allows enqueue
 */

import { createClient } from '@supabase/supabase-js';
import {
  enqueueAutofillJob,
  isJobNew,
  generateApplyDelay,
} from '../../lib/autofill-queue.js';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.substring(7);

  try {
    // Verify JWT token
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const userId = user.id;

    const body = parseBody(req);

    const {
      jobId,
      jobUrl,
      company,
      roleTitle,
      domain,
      formAnswers,
      resumeUrl,
      scheduledDelayMs,
    } = body;

    // Validation
    if (!jobId || !jobUrl || !company || !roleTitle || !formAnswers) {
      return res.status(400).json({
        error:
          'Missing required fields: jobId, jobUrl, company, roleTitle, formAnswers',
      });
    }

    // Check if user has credits
    const { data: credits, error: creditError } = await supabase
      .from('autofill_credits')
      .select('remaining_credits')
      .eq('user_id', userId)
      .single();

    if (creditError || !credits || credits.remaining_credits <= 0) {
      return res.status(402).json({
        error: 'Insufficient credits. Purchase more or wait for monthly reset.',
        remainingCredits: credits?.remaining_credits || 0,
      });
    }

    // Check for duplicate (within 24 hours)
    const isNew = await isJobNew({
      userId,
      company,
      roleTitle,
      windowHours: 24,
    });

    if (!isNew) {
      return res.status(409).json({
        error: 'Duplicate application detected. You already applied to this role in the last 24 hours.',
      });
    }

    let resolvedDomain = domain;
    if (!resolvedDomain) {
      try {
        resolvedDomain = new URL(jobUrl).hostname.replace('www.', '');
      } catch {
        return res.status(400).json({ error: 'Invalid jobUrl' });
      }
    }

    // Generate idempotency key
    const idempotencyKey = `${userId}:${jobId}:${Date.now()}`;

    // Generate delay
    const delay = scheduledDelayMs || generateApplyDelay({ strategy: 'uniform' });

    // Enqueue job
    const jobResult = await enqueueAutofillJob(
      {
        userId,
        jobId,
        jobUrl,
        company,
        roleTitle,
        domain: resolvedDomain,
        formAnswers,
        resumeUrl,
        idempotencyKey,
        scheduledDelayMs: delay,
        metadata: {
          enqueuedAt: new Date().toISOString(),
        },
      },
      {
        delay,
        priority: 5,
      }
    );

    // Save to Supabase for tracking
    const { error: dbError } = await supabase.from('autofill_jobs').insert({
      user_id: userId,
      job_id: jobId,
      company,
      role_title: roleTitle,
      job_url: jobUrl,
      domain: resolvedDomain,
      status: 'queued',
      idempotency_key: idempotencyKey,
      bullmq_job_id: jobResult.jobId,
      scheduled_delay_ms: delay,
      form_answers: formAnswers,
      resume_url: resumeUrl,
    });

    if (dbError) {
      console.error('Failed to save job to Supabase:', dbError);
      // Don't fail—job is in queue already
    }

    // Deduct credit (tentative; final deduction happens on success)
    // (We'll actually deduct via trigger when status = 'completed')

    return res.status(202).json({
      success: true,
      jobId: jobResult.jobId,
      status: 'queued',
      estimatedDelay: delay,
      message: `Application queued. Will be submitted in ${Math.round(delay / 1000)} seconds.`,
    });
  } catch (err) {
    console.error('Enqueue error:', err);
    return res.status(500).json({
      error: 'Failed to enqueue application',
      details: err.message,
    });
  }
}
