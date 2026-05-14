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

async function main() {
  const { data, error } = await supabase
    .from('autofill_jobs')
    .select('id, created_at, company, role_title, status, error_message, hitl_artifacts')
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) throw error;

  if (!data?.length) {
    console.log('No autofill jobs found.');
    return;
  }

  data.forEach((job, idx) => {
    const artifacts = job.hitl_artifacts || {};
    const screenshots = artifacts.screenshots || {};
    const submit = artifacts.submit || {};
    const page = artifacts.page || {};
    const fillAudit = artifacts.fillAudit || {};

    console.log(`\n#${idx + 1} ${job.company} — ${job.role_title}`);
    console.log(`Job ID: ${job.id}`);
    console.log(`Created: ${job.created_at}`);
    console.log(`Status: ${job.status}`);
    console.log(`Error: ${job.error_message || '-'}`);
    console.log(`Final URL: ${page.finalUrl || '-'}`);
    console.log(`Submit Attempted: ${submit.attempted === true ? 'yes' : 'no'}`);
    console.log(`Submit Confirmed Text Detected: ${submit.confirmationDetected === true ? 'yes' : 'no'}`);
    console.log(`Fields Filled: ${fillAudit.filledCount ?? 0}`);
    console.log(`Before Screenshot Captured: ${screenshots.beforeFillBase64 ? 'yes' : 'no'}`);
    console.log(`After Screenshot Captured: ${screenshots.afterSubmitBase64 ? 'yes' : 'no'}`);
  });
}

main().catch((err) => {
  console.error('[check-autofill-proof failed]', err?.message || err);
  process.exit(1);
});

