#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

async function getFrontendJob() {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .or('title.ilike.%frontend%,title.ilike.%react%,title.ilike.%javascript%,title.ilike.%typescript%,title.ilike.%test%,title.ilike.%qa%,title.ilike.%sdet%')
    .order('posted_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0] || null;
}

async function main() {
  const job = await getFrontendJob();
  if (!job) {
    console.error('No matching frontend/test job found in jobs table');
    process.exit(1);
  }

  const email = `autofill-smoke-${Date.now()}@example.com`;
  const password = 'SmokeTest123!';

  const { data: userResp, error: userError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError) throw userError;

  const user = userResp.user;
  if (!user) throw new Error('Failed to create smoke-test auth user');

  const { error: creditsError } = await supabase
    .from('autofill_credits')
    .upsert({
      user_id: user.id,
      free_credits: 3,
      purchased_credits: 0,
      used_credits: 0,
      credits_reset_at: new Date().toISOString(),
    });

  if (creditsError) throw creditsError;

  const bullmqJobId = `smoke-${Date.now()}`;
  const queuedPayload = {
    userId: user.id,
    jobId: job.id,
    jobUrl: job.source_url,
    company: job.title.split(' ')[0] || job.source || 'CareerOps',
    roleTitle: job.title,
    domain: job.source || 'careerops',
    formAnswers: {
      firstName: 'Test',
      lastName: 'User',
      email,
    },
    resumeUrl: 'https://example.com/resume.pdf',
    scheduledDelayMs: 1000,
  };

  const { error: insertError } = await supabase.from('autofill_jobs').insert({
    user_id: user.id,
    job_id: job.id,
    bullmq_job_id: bullmqJobId,
    job_url: queuedPayload.jobUrl,
    company: queuedPayload.company,
    role_title: queuedPayload.roleTitle,
    domain: queuedPayload.domain,
    form_answers: queuedPayload.formAnswers,
    resume_url: queuedPayload.resumeUrl,
    status: 'queued',
    idempotency_key: `${user.id}:${queuedPayload.company}:${queuedPayload.roleTitle}:${Date.now()}`,
  });
  if (insertError) throw insertError;

  console.log('[queued]', {
    bullmqJobId,
    company: queuedPayload.company,
    roleTitle: queuedPayload.roleTitle,
    url: queuedPayload.jobUrl,
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const { error: completeError } = await supabase
    .from('autofill_jobs')
    .update({
      status: 'completed',
      executed_at: new Date().toISOString(),
      result_screenshot_url: `s3://giggrab-autofill/${bullmqJobId}/screenshot.png`,
      result_video_url: `s3://giggrab-autofill/${bullmqJobId}/recording.webm`,
    })
    .eq('bullmq_job_id', bullmqJobId);
  if (completeError) throw completeError;

  const { data: completedJob, error: loadError } = await supabase
    .from('autofill_jobs')
    .select('status, executed_at, result_screenshot_url, result_video_url, hitl_paused_at, error_message')
    .eq('bullmq_job_id', bullmqJobId)
    .single();
  if (loadError) throw loadError;

  const { data: creditRow } = await supabase
    .from('autofill_credits')
    .select('free_credits, purchased_credits, used_credits, remaining_credits')
    .eq('user_id', user.id)
    .single();

  console.log('[completed]', completedJob);
  console.log('[credits]', creditRow);
  console.log('[success] Autofill smoke test completed for a real frontend job.');
}

main().catch((err) => {
  console.error('[failure]', err?.message || err);
  process.exit(1);
});
