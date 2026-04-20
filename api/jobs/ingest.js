import { ingestJobs } from '../../lib/jobs-ingestion.js';

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET || process.env.INGEST_CRON_SECRET;
  if (!secret) return true;

  const authHeader = String(req.headers?.authorization || '');
  const cronHeader = String(req.headers?.['x-cron-secret'] || '');
  return authHeader === `Bearer ${secret}` || cronHeader === secret;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!isAuthorized(req)) {
      return res.status(401).json({ success: false, message: 'unauthorized' });
    }

    try {
      const result = await ingestJobs();
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error('jobs_ingest_failed', error);
      return res.status(500).json({
        success: false,
        message: 'jobs_ingest_failed',
        detail: error?.message || 'unknown_error',
      });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'method_not_allowed' });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, message: 'unauthorized' });
  }

  try {
    const body = parseBody(req);
    const result = await ingestJobs({
      upworkInput: body.upwork_input,
      upworkTargets: body.upwork_targets,
      upworkDatasetIds: body.upwork_dataset_ids,
      linkedinInput: body.linkedin_input,
      linkedinDatasetIds: body.linkedin_dataset_ids,
      useStoredRuns: body.use_stored_runs,
      upworkActorId: body.upwork_actor_id,
      linkedinActorId: body.linkedin_actor_id,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('jobs_ingest_failed', error);
    return res.status(500).json({
      success: false,
      message: 'jobs_ingest_failed',
      detail: error?.message || 'unknown_error',
    });
  }
}
