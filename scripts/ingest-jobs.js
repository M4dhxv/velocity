import 'dotenv/config';
import { ingestJobs } from '../lib/jobs-ingestion.js';

async function main() {
  const result = await ingestJobs();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('jobs_ingest_failed', error?.message || error);
  process.exitCode = 1;
});
