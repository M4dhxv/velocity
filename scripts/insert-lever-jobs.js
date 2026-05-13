/**
 * Fetch real frontend web dev jobs from Lever public API
 * and insert into Supabase for autofill testing
 * 
 * Run with: node scripts/insert-lever-jobs.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Get from .env, or fallback to hardcoded values for Vercel
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xgqzuxosnypqohkqmkit.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  // Note: For security, service role keys should NOT be in code. This is for testing only.
  // In production, use Vercel env vars or a secure vault.
  process.env.VER_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    '[ERROR] SUPABASE_SERVICE_ROLE_KEY not found in .env or environment vars'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Fetch frontend jobs from Lever public API
 * Using real companies known to use Lever
 */
async function fetchLeverJobs() {
  console.log('[LEVER] Fetching real frontend web dev jobs...\n');

  const companies = ['stripe', 'retool', 'vercel'];
  const allJobs = [];

  for (const company of companies) {
    try {
      console.log(`  Fetching from ${company}...`);
      const url = `https://api.lever.co/v0/postings/company/${company}?mode=json`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`    ⚠️  Failed (${response.status})`);
        continue;
      }

      const postings = await response.json();

      // Filter for frontend/web roles
      const frontendJobs = postings
        .filter((job) => {
          const text = (job.text || '').toLowerCase();
          const desc = (job.description || '').toLowerCase();
          return (
            text.includes('frontend') ||
            text.includes('react') ||
            text.includes('web') ||
            text.includes('javascript') ||
            text.includes('typescript') ||
            desc.includes('frontend') ||
            desc.includes('react') ||
            desc.includes('web')
          );
        })
        .slice(0, 3) // Take first 3 per company
        .map((job) => ({
          title: job.text || 'Frontend Engineer',
          description:
            job.description ||
            'Join our team as a Frontend Engineer and build amazing web experiences.',
          skills: job.tags || ['JavaScript', 'React'],
          category: 'engineering',
          type: 'remote',
          job_type: 'full_time',
          location: job.categories?.location || 'Remote',
          source: 'lever',
          source_id: job.id,
          source_url: job.hostedUrl,
          client_verified: true,
          posted_at: job.createdAt || new Date().toISOString(),
        }));

      console.log(`    ✓ Found ${frontendJobs.length} jobs`);
      allJobs.push(...frontendJobs);
    } catch (err) {
      console.warn(`    ✗ Error: ${err.message}`);
    }
  }

  return allJobs;
}

/**
 * Fallback: sample frontend jobs if API fails
 */
function getFallbackJobs() {
  console.log('[FALLBACK] Using sample frontend jobs\n');
  return [
    {
      title: 'Frontend Engineer - React',
      description:
        'Build scalable React applications for millions of users. Work with modern tooling and mentor junior engineers.',
      skills: ['React', 'TypeScript', 'JavaScript'],
      category: 'engineering',
      type: 'remote',
      job_type: 'full_time',
      location: 'San Francisco, CA',
      source: 'sample',
      source_id: 'sample-fe-1',
      source_url: 'https://example.com/jobs/frontend-engineer',
      client_verified: true,
      posted_at: new Date().toISOString(),
    },
    {
      title: 'Senior Frontend Developer',
      description:
        'Lead our frontend team and define architecture for our web platform. Work with design and backend teams.',
      skills: ['React', 'Node.js', 'TypeScript', 'AWS'],
      category: 'engineering',
      type: 'remote',
      job_type: 'full_time',
      location: 'New York, NY',
      source: 'sample',
      source_id: 'sample-fe-2',
      source_url: 'https://example.com/jobs/senior-frontend',
      client_verified: true,
      posted_at: new Date().toISOString(),
    },
    {
      title: 'Web Developer - Vue.js',
      description:
        'Build interactive web applications using Vue.js. Collaborate with UX/design on responsive interfaces.',
      skills: ['Vue.js', 'JavaScript', 'CSS', 'REST APIs'],
      category: 'engineering',
      type: 'hybrid',
      job_type: 'full_time',
      location: 'Austin, TX',
      source: 'sample',
      source_id: 'sample-fe-3',
      source_url: 'https://example.com/jobs/web-developer-vue',
      client_verified: true,
      posted_at: new Date().toISOString(),
    },
  ];
}

async function main() {
  console.log('[START] Fetching real frontend web dev jobs\n');

  let jobs = await fetchLeverJobs();

  if (jobs.length === 0) {
    console.log('\n[INFO] No real jobs found; using fallback samples\n');
    jobs = getFallbackJobs();
  }

  console.log(`\n[TOTAL] ${jobs.length} jobs ready to insert\n`);

  try {
    const { data, error } = await supabase
      .from('jobs')
      .insert(jobs)
      .select();

    if (error) {
      console.error('[ERROR] Insert failed:', error);
      process.exit(1);
    }

    console.log(`[SUCCESS] Inserted ${data.length} frontend jobs\n`);
    console.log('Jobs added:');
    data.forEach((job, i) => {
      console.log(`${i + 1}. "${job.title}"`);
      console.log(`   Source: ${job.source}`);
      console.log(`   Location: ${job.location}`);
      console.log(`   URL: ${job.source_url}`);
      console.log(`   ID: ${job.id}\n`);
    });

    console.log('[NEXT] Test autofill by POSTing to /api/autofill/index:');
    const exampleJob = data[0];
    console.log(`
curl -X POST http://localhost:3000/api/autofill/index \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -d '{
    "jobId": "${exampleJob.id}",
    "jobUrl": "${exampleJob.source_url}",
    "company": "${exampleJob.title.split(' ')[0]}",
    "roleTitle": "${exampleJob.title}",
    "domain": "${exampleJob.source}",
    "formAnswers": {
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com"
    },
    "resumeUrl": "https://example.com/resume.pdf",
    "scheduledDelayMs": 5000
  }'
`);

    process.exit(0);
  } catch (err) {
    console.error('[ERROR]', err);
    process.exit(1);
  }
}

main();
