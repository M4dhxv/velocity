/**
 * Unified Autofill API Handler
 * 
 * Handles all autofill operations in a single serverless function:
 * - POST / => Enqueue a job
 * - GET /?jobId=... => Check job status
 * - DELETE /?jobId=... => Cancel a job
 * 
 * Reduces serverless function count for Vercel Hobby plan (max 12).
 */

import { createClient } from '@supabase/supabase-js';
import {
  enqueueAutofillJob,
  generateApplyDelay,
  getAutofillJobStatus,
  cancelAutofillJob,
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '').trim()
  );
}

/**
 * Verify JWT and extract user
 */
async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: 'Unauthorized', status: 401 };
  }

  const token = authHeader.substring(7);

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return { error: 'Invalid token', status: 401 };
    }

    return { user };
  } catch (err) {
    return { error: 'Auth error', status: 500 };
  }
}

/**
 * POST / => Enqueue
 */
async function handleEnqueue(req, res, userId) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // Credits temporarily bypassed for debugging stability.

  // Dedupe check intentionally disabled for debugging so repeated applies are allowed.

  try {
    let resolvedJobId = String(jobId).trim();

    // If frontend passed a non-UUID fallback id, resolve from jobs table by URL.
    if (!isUuid(resolvedJobId)) {
      const { data: dbJob, error: jobLookupError } = await supabase
        .from('jobs')
        .select('id')
        .eq('source_url', jobUrl)
        .limit(1)
        .maybeSingle();

      if (jobLookupError) {
        return res.status(500).json({
          error: 'Failed to resolve job ID',
          details: jobLookupError.message,
        });
      }

      if (!dbJob?.id || !isUuid(dbJob.id)) {
        return res.status(400).json({
          error: 'Invalid jobId and no jobs.id found for provided jobUrl',
        });
      }

      resolvedJobId = dbJob.id;
    }

    const enqueuePayload = {
      userId,
      jobId: resolvedJobId,
      jobUrl,
      company,
      roleTitle,
      domain: domain || new URL(jobUrl).hostname,
      formAnswers,
      resumeUrl,
      scheduledDelayMs: scheduledDelayMs || generateApplyDelay(),
    };

    // Enforce a hard timeout to avoid Vercel 504s from long Redis hangs.
    const bullmqJobId = await Promise.race([
      enqueueAutofillJob(enqueuePayload),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('ENQUEUE_TIMEOUT: Redis/queue did not respond in time')),
          7000
        )
      ),
    ]);

    // Insert into autofill_jobs table
    const { data: dbJob, error: insertError } = await supabase
      .from('autofill_jobs')
      .insert({
        user_id: userId,
        job_id: resolvedJobId,
        bullmq_job_id: bullmqJobId,
        job_url: jobUrl,
        company,
        role_title: roleTitle,
        domain: domain || new URL(jobUrl).hostname,
        form_answers: formAnswers,
        resume_url: resumeUrl,
        status: 'queued',
        idempotency_key: `${userId}:${company}:${roleTitle}:${Date.now()}`,
      });

    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(500).json({
        error: 'Failed to enqueue job',
        details: insertError.message,
      });
    }

    return res.status(202).json({
      bullmqJobId,
      status: 'queued',
      message: 'Job enqueued successfully',
    });
  } catch (err) {
    console.error('Enqueue error:', err);
    const msg = String(err?.message || '');
    if (msg.includes('REDIS_CONNECT_FAILED')) {
      return res.status(503).json({
        error: 'Queue unavailable',
        details: msg,
      });
    }
    if (msg.includes('ENQUEUE_TIMEOUT')) {
      return res.status(504).json({
        error: 'Queue timeout',
        details: msg,
      });
    }
    return res.status(500).json({
      error: 'Failed to enqueue job',
      details: msg || 'unknown enqueue error',
    });
  }
}

/**
 * GET /?jobId=... => Status
 */
async function handleStatus(req, res, userId) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobId } = req.query;

  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId parameter' });
  }

  try {
    // Verify ownership: job must belong to this user
    const { data: job, error: queryError } = await supabase
      .from('autofill_jobs')
      .select('*')
      .eq('bullmq_job_id', jobId)
      .eq('user_id', userId)
      .single();

    if (queryError || !job) {
      return res.status(404).json({ error: 'Job not found or access denied' });
    }

    // Get BullMQ status
    const bullmqStatus = await getAutofillJobStatus(jobId);

    return res.status(200).json({
      jobId: job.id,
      bullmqJobId: job.bullmq_job_id,
      status: job.status,
      progress: bullmqStatus.progress || 0,
      attempts: bullmqStatus.attempts || 0,
      createdAt: job.created_at,
      executedAt: job.executed_at,
      completedAt: job.updated_at,
      company: job.company,
      roleTitle: job.role_title,
      error: job.error_message,
      resultScreenshot: job.result_screenshot_url,
      resultVideo: job.result_video_url,
      hitlStatus: job.hitl_paused_at ? 'paused' : null,
      hitlReason: job.hitl_reason,
    });
  } catch (err) {
    console.error('Status check error:', err);
    return res.status(500).json({
      error: 'Failed to check job status',
      details: err.message,
    });
  }
}

/**
 * DELETE /?jobId=... => Cancel
 */
async function handleCancel(req, res, userId) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { jobId } = req.query;

  if (!jobId) {
    return res.status(400).json({ error: 'Missing jobId parameter' });
  }

  try {
    // Verify ownership
    const { data: job, error: queryError } = await supabase
      .from('autofill_jobs')
      .select('*')
      .eq('bullmq_job_id', jobId)
      .eq('user_id', userId)
      .single();

    if (queryError || !job) {
      return res.status(404).json({ error: 'Job not found or access denied' });
    }

    // Can only cancel if not yet completed
    if (job.status === 'completed' || job.status === 'failed') {
      return res.status(400).json({
        error: `Cannot cancel job with status: ${job.status}`,
      });
    }

    // Cancel from BullMQ
    const cancelled = await cancelAutofillJob(jobId);

    if (!cancelled) {
      return res.status(404).json({ error: 'Job not found in queue' });
    }

    // Update Supabase
    const { error: updateError } = await supabase
      .from('autofill_jobs')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('bullmq_job_id', jobId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to cancel job' });
    }

    return res.status(200).json({
      jobId,
      status: 'cancelled',
      message: 'Job cancelled successfully',
    });
  } catch (err) {
    console.error('Cancel error:', err);
    return res.status(500).json({
      error: 'Failed to cancel job',
      details: err.message,
    });
  }
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Verify auth for all methods
  const authResult = await verifyAuth(req);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  const userId = authResult.user.id;

  // Route based on HTTP method
  if (req.method === 'POST') {
    return handleEnqueue(req, res, userId);
  } else if (req.method === 'GET') {
    return handleStatus(req, res, userId);
  } else if (req.method === 'DELETE') {
    return handleCancel(req, res, userId);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
