/**
 * Autofill Worker Processor
 * 
 * Runs outside Vercel (Docker, Fly, ECS, or bare metal)
 * Consumes jobs from BullMQ and orchestrates Playwright fills
 * 
 * Run with: node workers/autofill-processor.js
 * Deploy as: Docker service with restart policy
 */

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import {
  calculateBackoffWithJitter,
  pauseForHITL,
} from '../lib/autofill-queue.js';
import {
  checkDomainRateLimit,
  manageGlobalConcurrency,
  recordDomainFailure,
  getRateLimitStats,
} from '../lib/rate-limiter.js';

// Initialize clients
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  ...(redisUrl.startsWith('rediss://')
    ? { tls: { rejectUnauthorized: false } }
    : {}),
});
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  throw new Error(
    'Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY fallback)'
  );
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[STARTUP] SUPABASE_SERVICE_ROLE_KEY not set; falling back to SUPABASE_ANON_KEY. Some writes may be blocked by RLS.'
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  supabaseKey
);

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5');

/**
 * Main worker: processes autofill jobs
 */
const createAutofillWorker = () => {
  return new Worker(
    'autofill-applications',
    async (job) => {
      console.log(`[${job.id}] Starting autofill for ${job.data.company} - ${job.data.roleTitle}`);

      try {
        // 1. Check global concurrency
        const concurrencyCheck = await manageGlobalConcurrency({
          maxConcurrent: WORKER_CONCURRENCY,
          operation: 'acquire',
        });

        if (!concurrencyCheck.acquired) {
          // Queue is full, retry later
          console.warn(`[${job.id}] Global concurrency limit reached, retrying in 10s`);
          throw new Error('RETRY_LATER: Concurrency limit reached');
        }

        try {
          // 2. Check per-domain rate limit
          const rateLimitCheck = await checkDomainRateLimit(job.data.domain);

          if (!rateLimitCheck.allowed) {
            console.warn(
              `[${job.id}] Domain rate limit exceeded (${job.data.domain}), retrying in ${rateLimitCheck.waitMs}ms`
            );
            throw new Error(
              `RETRY_LATER: Rate limit (wait ${rateLimitCheck.waitMs}ms)`
            );
          }

          // 3. Apply delay (randomized, human-like)
          const applyDelay = job.data.scheduledDelayMs || 15000;
          console.log(`[${job.id}] Waiting ${applyDelay}ms before apply...`);
          await new Promise((resolve) => setTimeout(resolve, applyDelay));

          // 4. Execute Playwright fill
          const fillResult = await executePlaywrightFill({
            jobId: job.id,
            ...job.data,
          });

          // 5. Update Supabase with success
          await supabase
            .from('autofill_jobs')
            .update({
              status: 'completed',
              executed_at: new Date().toISOString(),
              result_screenshot_url: fillResult.screenshotUrl,
              result_video_url: fillResult.videoUrl,
            })
            .eq('bullmq_job_id', job.id);

          console.log(
            `[${job.id}] ✅ Successfully completed: ${job.data.company}`
          );

          return {
            success: true,
            company: job.data.company,
            screenshot: fillResult.screenshotUrl,
          };
        } finally {
          // Always release concurrency slot
          await manageGlobalConcurrency({
            operation: 'release',
          });
        }
      } catch (err) {
        // Handle HITL scenarios (CAPTCHA, blocked, etc)
        if (err.isHITLRequired) {
          console.warn(`[${job.id}] HITL required: ${err.reason}`);

          await pauseForHITL({
            jobId: job.id,
            reason: err.reason,
            artifacts: err.artifacts,
          });

          // Update Supabase
          await supabase
            .from('autofill_jobs')
            .update({
              status: 'paused',
              hitl_paused_at: new Date().toISOString(),
              hitl_reason: err.reason,
              hitl_artifacts: err.artifacts || {},
              result_screenshot_url: err.artifacts?.screenshot,
            })
            .eq('bullmq_job_id', job.id);

          // Create HITL queue entry
          const { data: autofillJob } = await supabase
            .from('autofill_jobs')
            .select('id')
            .eq('bullmq_job_id', job.id)
            .single();

          if (autofillJob) {
            await supabase.from('autofill_hitl_queue').insert({
              autofill_job_id: autofillJob.id,
              reason: err.reason,
              description: err.message,
              artifacts: err.artifacts,
            });
          }

          throw new Error('PAUSED_FOR_HITL');
        }

        // Handle rate limit retry
        if (err.message.includes('RETRY_LATER')) {
          console.warn(`[${job.id}] Retry scheduled: ${err.message}`);
          await recordDomainFailure(job.data.domain, err);
          throw err;
        }

        // Permanent failure
        console.error(`[${job.id}] ❌ Failed: ${err.message}`);

        await supabase
          .from('autofill_jobs')
          .update({
            status: 'failed',
            error_message: err.message,
            error_stacktrace: err.stack,
          })
          .eq('bullmq_job_id', job.id);

        await recordDomainFailure(job.data.domain, err);

        throw err;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONCURRENCY,
      settings: {
        backoffStrategies: {
          exponential: (attemptsMade, _type, err) => {
            return calculateBackoffWithJitter(attemptsMade);
          },
        },
      },
    }
  );
};

/**
 * Execute Playwright autofill
 * 
 * Launches browser, fills job application form, and captures results
 */
async function executePlaywrightFill(jobData) {
  const { jobId, jobUrl, company, roleTitle, formAnswers = {}, resumeUrl } =
    jobData;
  const headless =
    jobData.headless !== undefined
      ? Boolean(jobData.headless)
      : process.env.AUTOFILL_HEADLESS !== 'false';

  let browser;
  let page;

  try {
    console.log(`[${jobId}] Launching Playwright for ${jobUrl}`);
    const chromium = require('playwright').chromium;
    
    browser = await chromium.launch({ 
      headless,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    
    page = await browser.newPage();
    
    // Set user agent to avoid detection
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    );

    // Navigate to job URL
    console.log(`[${jobId}] Navigating to ${jobUrl}`);
    await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for form to load
    await page.waitForSelector('form, [role="form"]', { timeout: 10000 }).catch(() => {
      console.warn(`[${jobId}] No form found, continuing anyway`);
    });

    // Fill form fields
    await fillFormFields(page, jobId, formAnswers);

    // Upload resume if provided
    if (resumeUrl) {
      await uploadResume(page, jobId, resumeUrl);
    }

    // Find and click submit button
    const submitButton = await findSubmitButton(page);
    if (submitButton) {
      console.log(`[${jobId}] Clicking submit button`);
      await submitButton.click();
      
      // Wait for navigation or confirmation
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {
        console.log(`[${jobId}] No navigation after submit (expected on some ATS)`);
      });
    } else {
      console.warn(`[${jobId}] No submit button found`);
    }

    // Capture screenshot
    const screenshotPath = `/tmp/${jobId}-screenshot.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[${jobId}] Screenshot saved to ${screenshotPath}`);

    // Return success with mock S3 URLs (in production, upload to S3)
    return {
      screenshotUrl: `s3://giggrab-autofill/${jobId}/screenshot.png`,
      videoUrl: null, // Video recording disabled for performance
    };

  } catch (err) {
    console.error(`[${jobId}] Playwright error: ${err.message}`);
    throw {
      reason: 'FILL_FAILED',
      message: err.message,
      artifacts: null,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Fill form fields with user data
 */
async function fillFormFields(page, jobId, formAnswers) {
  console.log(`[${jobId}] Filling form fields`);

  // Get all input fields
  const inputs = await page.$$('input[type="text"], input[type="email"], textarea, select');
  
  for (const input of inputs) {
    try {
      const name = await input.getAttribute('name');
      const type = await input.getAttribute('type');
      const id = await input.getAttribute('id');
      const placeholder = await input.getAttribute('placeholder');
      
      // Determine field type
      let fieldKey = name || id || placeholder || '';
      fieldKey = fieldKey.toLowerCase();

      let value = null;

      // Map common field names to form answers
      if (fieldKey.includes('first') || fieldKey.includes('fname')) {
        value = formAnswers.firstName || formAnswers.first_name || 'John';
      } else if (fieldKey.includes('last') || fieldKey.includes('lname')) {
        value = formAnswers.lastName || formAnswers.last_name || 'Doe';
      } else if (fieldKey.includes('email')) {
        value = formAnswers.email || 'john@example.com';
      } else if (fieldKey.includes('phone')) {
        value = formAnswers.phone || '+1-555-0000';
      } else if (fieldKey.includes('location') || fieldKey.includes('city')) {
        value = formAnswers.location || formAnswers.city || 'San Francisco';
      } else if (fieldKey.includes('experience') || fieldKey.includes('years')) {
        value = formAnswers.yearsExperience || '5';
      } else if (fieldKey.includes('linkedin')) {
        value = formAnswers.linkedin || 'https://linkedin.com/in/johndoe';
      } else if (fieldKey.includes('website') || fieldKey.includes('portfolio')) {
        value = formAnswers.website || formAnswers.portfolio || '';
      } else if (fieldKey.includes('message') || fieldKey.includes('cover') || fieldKey.includes('comment')) {
        value = formAnswers.message || formAnswers.coverLetter || 'Interested in this opportunity.';
      }

      if (value) {
        console.log(`[${jobId}] Filling ${fieldKey} = ${value.substring(0, 20)}`);
        await input.fill(value);
      }
    } catch (err) {
      console.warn(`[${jobId}] Error filling field: ${err.message}`);
    }
  }

  // Fill select dropdowns
  const selects = await page.$$('select');
  for (const select of selects) {
    try {
      const name = await select.getAttribute('name');
      const id = await select.getAttribute('id');
      const fieldKey = (name || id || '').toLowerCase();

      if (fieldKey.includes('experience') || fieldKey.includes('level')) {
        await select.selectOption('Mid-level');
      } else if (fieldKey.includes('country') || fieldKey.includes('location')) {
        // Try common options
        const options = await select.$$('option');
        if (options.length > 1) {
          await select.selectOption({ index: 1 });
        }
      }
    } catch (err) {
      console.warn(`[${jobId}] Error selecting dropdown: ${err.message}`);
    }
  }
}

/**
 * Upload resume file
 */
async function uploadResume(page, jobId, resumeUrl) {
  try {
    console.log(`[${jobId}] Uploading resume from ${resumeUrl}`);

    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length === 0) {
      console.warn(`[${jobId}] No file input found for resume`);
      return;
    }

    // For now, just mark that we found the file input
    // In production, download resumeUrl and upload the file
    console.log(`[${jobId}] Resume upload field found (mock: skipping actual upload)`);
  } catch (err) {
    console.warn(`[${jobId}] Error uploading resume: ${err.message}`);
  }
}

/**
 * Find and return submit button
 */
async function findSubmitButton(page) {
  const selectors = [
    'button[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'button:has-text("Send")',
    'input[type="submit"]',
  ];

  for (const selector of selectors) {
    try {
      const button = await page.$(selector);
      if (button && (await button.isVisible())) {
        return button;
      }
    } catch (err) {
      // Selector not found, continue
    }
  }

  return null;
}

/**
 * Graceful shutdown
 */
async function shutdown(worker, signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}, draining worker...`);

  // Close worker (stops consuming new jobs)
  await worker.close();

  console.log('[SHUTDOWN] Worker closed successfully');
  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  console.log(
    `[STARTUP] Autofill Worker started (concurrency: ${WORKER_CONCURRENCY})`
  );

  const worker = createAutofillWorker();

  // Event listeners
  worker.on('completed', (job) => {
    console.log(
      `[COMPLETED] Job ${job.id}: ${job.data.company} - ${job.data.roleTitle}`
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`[FAILED] Job ${job.id}: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error(`[WORKER ERROR] ${err.message}`, err);
  });

  // Periodic stats logging
  setInterval(async () => {
    const stats = await getRateLimitStats();
    console.log('[STATS]', JSON.stringify(stats, null, 2));
  }, 60000); // Every minute

  // Graceful shutdown on signals
  process.on('SIGTERM', () => shutdown(worker, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(worker, 'SIGINT'));
}

main().catch((err) => {
  console.error('[FATAL] Worker initialization failed:', err);
  process.exit(1);
});
