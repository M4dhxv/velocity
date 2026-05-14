#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { normalizeJob } from '../lib/jobs-ingestion.js';
import { getSupabaseClient } from '../lib/onboarding.js';

async function readJsonFiles(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const items = [];
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const raw = fs.readFileSync(full, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items.push(...parsed);
      else items.push(parsed);
    } catch (err) {
      console.warn('Skipping', full, err?.message || err);
    }
  }
  return items;
}

async function main() {
  const dir = process.argv[2] || 'data/careerops';
  if (!fs.existsSync(dir)) {
    console.error('Directory not found:', dir);
    process.exit(1);
  }

  console.log('Reading JSON files from', dir);
  const rawItems = await readJsonFiles(dir);
  console.log('Loaded items:', rawItems.length);

  const normalized = rawItems.map((item) => normalizeJob(item, 'careerops'));

  const supabase = getSupabaseClient();
  const chunkSize = 200;
  let processed = 0;

  for (let i = 0; i < normalized.length; i += chunkSize) {
    const chunk = normalized.slice(i, i + chunkSize);
    const { error } = await supabase.from('jobs').upsert(chunk, { onConflict: 'source,source_id' });
    if (error) throw new Error(`Supabase jobs upsert failed: ${error.message}`);
    processed += chunk.length;
  }

  console.log('Upsert result:', { inserted: processed });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
