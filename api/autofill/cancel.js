/**
 * DELETE /api/autofill/cancel/:jobId
 * 
 * Cancel a queued or paused autofill job
 */

import { cancelAutofillJob } from '../../lib/autofill-queue.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
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
      console.error('Failed to update job status:', updateError);
    }

    return res.status(200).json({
      success: true,
      jobId: job.id,
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
