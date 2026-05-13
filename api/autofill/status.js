/**
 * GET /api/autofill/status/:jobId
 * 
 * Check status of an autofill job
 */

import { getAutofillJobStatus } from '../../lib/autofill-queue.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
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
    const { jobId } = req.query;

    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId parameter' });
    }

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
