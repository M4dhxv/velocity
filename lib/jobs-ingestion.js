import crypto from 'node:crypto';
import { getSupabaseClient } from './onboarding.js';

const APIFY_BASE_URL = 'https://api.apify.com/v2';

export const SKILL_MAP = {
  frontend: ['react', 'javascript', 'html', 'css'],
  backend: ['node', 'python', 'api'],
  design: ['figma', 'ui', 'ux'],
  marketing: ['seo', 'ads', 'social media'],
};

const DEFAULT_UPWORK_TARGETS = [
  { query: 'frontend developer', limit: 20 },
  { query: 'react developer', limit: 20 },
  { query: 'web developer', limit: 20 },
  { query: 'python developer', limit: 10 },
  { query: 'bug fixing', limit: 10 },
  { query: 'graphic designer', limit: 20 },
  { query: 'logo design', limit: 10 },
  { query: 'video editor', limit: 15 },
  { query: 'ui ux designer', limit: 10 },
  { query: 'thumbnail designer', limit: 5 },
  { query: 'content writer', limit: 20 },
  { query: 'blog writer', limit: 10 },
  { query: 'copywriting', limit: 10 },
  { query: 'ghostwriting', limit: 5 },
  { query: 'social media manager', limit: 15 },
  { query: 'instagram marketing', limit: 10 },
  { query: 'seo', limit: 10 },
  { query: 'email marketing', limit: 5 },
  { query: 'data entry', limit: 15 },
  { query: 'virtual assistant', limit: 15 },
  { query: 'online research', limit: 5 },
  { query: 'simple tasks', limit: 5 },
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function uniqueNonEmpty(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach((v) => {
    const value = String(v || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

function getApifyTokens(options = {}) {
  const fromOptions = Array.isArray(options.apifyTokens) ? options.apifyTokens : [];
  const fromEnvPool = String(process.env.APIFY_TOKENS || '')
    .split(/[\n,\s]+/)
    .filter(Boolean);
  const fromSingle = process.env.APIFY_TOKEN ? [process.env.APIFY_TOKEN] : [];

  const tokens = uniqueNonEmpty([...fromOptions, ...fromSingle, ...fromEnvPool]);
  if (!tokens.length) throw new Error('Missing APIFY_TOKEN');
  return tokens;
}

function isQuotaLikeError(error) {
  const text = String(error?.message || '').toLowerCase();
  return [
    'free tier',
    'quota',
    'limit exceeded',
    'monthly usage',
    'insufficient credits',
    'payment required',
    'rate limit',
    'http 402',
    '(402)',
  ].some((needle) => text.includes(needle));
}

function trimText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clampDescription(text, maxLen = 1000) {
  const cleaned = trimText(text);
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function pickFirst(obj, keys, fallback = '') {
  for (const key of keys) {
    const value = obj?.[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && trimText(value)) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value;
  }
  return fallback;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!cleaned) return null;
    const parsed = Number(cleaned[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCurrency(text = '') {
  const raw = trimText(text).toUpperCase();
  if (!raw) return 'USD';
  if (raw.includes('USD') || raw.includes('$')) return 'USD';
  if (raw.includes('EUR') || raw.includes('€')) return 'EUR';
  if (raw.includes('GBP') || raw.includes('£')) return 'GBP';
  if (raw.includes('INR') || raw.includes('₹')) return 'INR';
  return raw.slice(0, 3) || 'USD';
}

function parseHourlyRange(job = {}) {
  const directMin = parseNumber(pickFirst(job, ['hourly_rate_min', 'hourlyRateMin', 'hourlyMin', 'minHourlyRate'], null));
  const directMax = parseNumber(pickFirst(job, ['hourly_rate_max', 'hourlyRateMax', 'hourlyMax', 'maxHourlyRate'], null));
  if (directMin !== null || directMax !== null) return [directMin, directMax];

  const hourlyText = trimText(
    pickFirst(job, [
      'hourlyRate',
      'hourly_rate',
      'hourly_budget',
      'salary',
      'compensation',
      'budget',
      'price',
      'jobType',
    ], '')
  );

  if (!hourlyText) return [null, null];

  const rangeMatch = hourlyText.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)/i);
  if (rangeMatch) {
    return [Number(rangeMatch[1]), Number(rangeMatch[2])];
  }

  const oneNumber = parseNumber(hourlyText);
  return [oneNumber, oneNumber];
}

function parseBudget(job = {}) {
  return parseNumber(pickFirst(job, ['budget', 'fixedPrice', 'fixed_price', 'price', 'amount'], null));
}

function parsePostedAt(job = {}) {
  const raw = pickFirst(
    job,
    ['posted_at', 'postedAt', 'publishedAt', 'createdAt', 'datePosted', 'created_time', 'absoluteDate', 'relativeDate'],
    ''
  );
  if (!raw) return new Date().toISOString();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function parseTags(job = {}) {
  const tags = job?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => trimText(tag))
    .filter(Boolean)
    .slice(0, 24);
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const out = [];
  values.forEach((v) => {
    const value = trimText(v);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out;
}

function extractSkills(text = '') {
  const haystack = trimText(text).toLowerCase();
  const found = new Set();

  Object.values(SKILL_MAP).forEach((keywords) => {
    keywords.forEach((keyword) => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const asPhrase = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      if (asPhrase.test(haystack)) found.add(keyword);
    });
  });

  return [...found];
}

function detectCategory(skills = []) {
  const lower = new Set(skills.map((s) => String(s).toLowerCase()));

  if (lower.has('react') || lower.has('javascript')) return 'frontend';
  if (lower.has('python') || lower.has('node')) return 'backend';
  if (lower.has('figma')) return 'design';
  return 'general';
}

function detectType(text = '') {
  return /\bremote\b/i.test(text) ? 'remote' : 'local';
}

function detectJobType(text = '', jobTypeRaw = '') {
  const typeBlob = `${text} ${jobTypeRaw}`;
  if (/\b(hourly|fixed\s*price|fixed|freelance|contract)\b/i.test(typeBlob)) return 'freelance';
  return 'contract';
}

function normalizeSourceId(job = {}, source, sourceUrl, title, description) {
  const direct = trimText(
    String(
      pickFirst(job, ['source_id', 'sourceId', 'subId', 'id', 'jobId', 'job_id', 'urn', 'uid'], '')
    )
  );
  if (direct) return direct;

  const hash = crypto
    .createHash('sha256')
    .update(`${source}|${sourceUrl}|${title}|${description.slice(0, 120)}`)
    .digest('hex')
    .slice(0, 24);
  return hash;
}

export function normalizeJob(job, source) {
  const title = trimText(pickFirst(job, ['title', 'jobTitle', 'positionName', 'name'], 'Untitled job'));
  const description = clampDescription(
    pickFirst(job, ['description', 'jobDescription', 'snippet', 'text', 'summary'], '')
  );

  const sourceUrl = trimText(pickFirst(job, ['source_url', 'sourceUrl', 'url', 'jobUrl', 'link'], ''));
  const location = trimText(pickFirst(job, ['location', 'jobLocation', 'clientLocation', 'city', 'country'], ''));
  const tags = parseTags(job);

  const textBlob = `${title} ${description} ${location} ${tags.join(' ')}`;
  const skills = dedupeStrings([
    ...extractSkills(textBlob),
    ...tags,
  ]).slice(0, 24);
  const category = detectCategory(skills);
  const type = detectType(textBlob);
  const jobType = detectJobType(textBlob, String(job?.jobType || ''));

  const [hourlyRateMin, hourlyRateMax] = parseHourlyRange(job);

  const currencyRaw = pickFirst(job, ['currency', 'currencyCode', 'salaryCurrency', 'budgetCurrency'], 'USD');
  const currency = parseCurrency(String(currencyRaw));

  const normalized = {
    title,
    description,
    skills,
    category,
    type,
    job_type: jobType,
    budget: parseBudget(job),
    hourly_rate_min: hourlyRateMin,
    hourly_rate_max: hourlyRateMax,
    currency,
    location,
    source,
    source_id: normalizeSourceId(job, source, sourceUrl, title, description),
    source_url: sourceUrl,
    client_verified: Boolean(
      pickFirst(job, ['client_verified', 'clientVerified', 'isClientVerified', 'isClientPaymentVerified', 'paymentVerified'], false)
    ),
    posted_at: parsePostedAt(job),
  };

  return normalized;
}

async function apifyRequest(path, token, options = {}) {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${APIFY_BASE_URL}${path}${separator}token=${encodeURIComponent(token)}`;
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Apify request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function triggerActorRun(actorId, token, actorInput = {}) {
  const data = await apifyRequest(
    `/acts/${encodeURIComponent(actorId)}/runs`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorInput || {}),
    }
  );

  const run = data?.data;
  if (!run?.id) throw new Error(`Actor run did not return an id for actor ${actorId}`);
  return run;
}

async function waitForRunToFinish(actorId, runId, token, options = {}) {
  const pollIntervalMs = options.pollIntervalMs || 4000;
  const timeoutMs = options.timeoutMs || 8 * 60 * 1000;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await apifyRequest(
      `/acts/${encodeURIComponent(actorId)}/runs/${encodeURIComponent(runId)}`,
      token
    );

    const run = data?.data;
    const status = String(run?.status || '').toUpperCase();

    if (status === 'SUCCEEDED') return run;
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
      throw new Error(`Actor run ${runId} ended with status: ${status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Actor run ${runId} timed out after ${Math.round(timeoutMs / 1000)}s`);
}

async function fetchDatasetItems(datasetId, token) {
  const data = await apifyRequest(
    `/datasets/${encodeURIComponent(datasetId)}/items?clean=true`,
    token
  );

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function fetchLatestSuccessfulDatasetId(actorId, tokens = []) {
  let lastError = null;

  for (const token of tokens) {
    try {
      const data = await apifyRequest(
        `/acts/${encodeURIComponent(actorId)}/runs?limit=20&desc=1`,
        token
      );

      const runs = Array.isArray(data?.data?.items) ? data.data.items : [];
      const successful = runs.find((run) => String(run?.status || '').toUpperCase() === 'SUCCEEDED' && run?.defaultDatasetId);
      if (successful?.defaultDatasetId) {
        return {
          datasetId: successful.defaultDatasetId,
          runId: successful.id || '',
        };
      }

      return { datasetId: '', runId: '' };
    } catch (error) {
      lastError = error;
      if (isQuotaLikeError(error)) continue;
      throw error;
    }
  }

  if (lastError) throw lastError;
  return { datasetId: '', runId: '' };
}

function dedupeJobs(jobs = []) {
  const seen = new Set();
  const deduped = [];

  for (const job of jobs) {
    const key = `${job.source}::${job.source_id || ''}::${job.source_url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(job);
  }

  return deduped;
}

async function upsertJobs(jobs = []) {
  if (!jobs.length) return { inserted: 0 };

  const supabase = getSupabaseClient();
  const chunkSize = 200;
  let processed = 0;

  for (let i = 0; i < jobs.length; i += chunkSize) {
    const chunk = jobs.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('jobs')
      .upsert(chunk, { onConflict: 'source,source_id' });

    if (error) {
      throw new Error(`Supabase jobs upsert failed: ${error.message}`);
    }

    processed += chunk.length;
  }

  return { inserted: processed };
}

function parseActorInput(rawValue) {
  if (!rawValue) return {};
  if (typeof rawValue === 'object') return rawValue;

  try {
    return JSON.parse(rawValue);
  } catch {
    return {};
  }
}

function parseDatasetIds(rawValue) {
  if (!rawValue) return [];
  if (Array.isArray(rawValue)) {
    return uniqueNonEmpty(rawValue.map((v) => String(v || '').trim()));
  }

  const text = String(rawValue || '').trim();
  if (!text) return [];

  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return parseDatasetIds(parsed);
    } catch {
      // fall through to split parser
    }
  }

  return uniqueNonEmpty(text.split(/[\n,\s]+/).filter(Boolean));
}

async function ingestFromDatasets({ source, actorId, datasetIds, tokens }) {
  const ids = parseDatasetIds(datasetIds);
  if (!ids.length) {
    return {
      source,
      actorId,
      runs: [],
      runId: '',
      datasetId: '',
      rawCount: 0,
      normalizedCount: 0,
      insertedOrUpdated: 0,
    };
  }

  let rawCount = 0;
  let normalizedCount = 0;
  let insertedOrUpdated = 0;
  const runs = [];

  for (const datasetId of ids) {
    let rawItems = null;
    let lastError = null;

    for (const token of tokens) {
      try {
        rawItems = await fetchDatasetItems(datasetId, token);
        break;
      } catch (error) {
        lastError = error;
        if (isQuotaLikeError(error)) continue;
        throw error;
      }
    }

    if (!rawItems) {
      throw lastError || new Error(`Unable to fetch Apify dataset ${datasetId}`);
    }

    const normalized = rawItems.map((item) => normalizeJob(item, source));
    const cleaned = dedupeJobs(normalized);
    const upsertResult = await upsertJobs(cleaned);

    rawCount += rawItems.length;
    normalizedCount += cleaned.length;
    insertedOrUpdated += upsertResult.inserted;
    runs.push({ runId: '', datasetId, input: { imported_from_dataset: true } });
  }

  return {
    source,
    actorId,
    runs,
    runId: '',
    datasetId: ids[0] || '',
    rawCount,
    normalizedCount,
    insertedOrUpdated,
  };
}

function normalizeTargets(rawTargets = []) {
  if (!Array.isArray(rawTargets)) return [];
  return rawTargets
    .map((item) => {
      if (!item) return null;
      if (typeof item === 'string') {
        const query = trimText(item);
        if (!query) return null;
        return { query, limit: 10 };
      }

      const query = trimText(item.query || item.term || item.keyword || '');
      if (!query) return null;
      const limit = Math.max(1, Number(item.limit || item.maxItems || item.max || 10) || 10);
      return { query, limit };
    })
    .filter(Boolean);
}

function assignInputField(target, template, fieldNameCandidates = []) {
  const output = { ...template };
  const queryField = fieldNameCandidates[0] || 'query';
  const limitField = fieldNameCandidates[1] || 'maxItems';
  output[queryField] = target.query;
  output[limitField] = target.limit;

  // Add compatibility fallbacks for common actor schemas.
  output.query = target.query;
  output.maxItems = target.limit;
  return output;
}

function buildUpworkActorInputs(options = {}) {
  const explicitTargets = normalizeTargets(options.upworkTargets);
  const envTargets = normalizeTargets(parseActorInput(process.env.APIFY_UPWORK_TARGETS));
  const targets = explicitTargets.length ? explicitTargets : (envTargets.length ? envTargets : DEFAULT_UPWORK_TARGETS);

  const template = parseActorInput(options.upworkInput || process.env.APIFY_UPWORK_INPUT);
  const queryField = String(process.env.APIFY_UPWORK_QUERY_FIELD || 'query').trim() || 'query';
  const limitField = String(process.env.APIFY_UPWORK_LIMIT_FIELD || 'maxItems').trim() || 'maxItems';

  return targets.map((target) => assignInputField(target, template, [queryField, limitField]));
}

async function ingestFromActor({ source, actorId, actorInput, actorInputs, tokens }) {
  const inputs = Array.isArray(actorInputs) && actorInputs.length
    ? actorInputs
    : [actorInput || {}];

  const runs = [];
  let rawCount = 0;
  let normalizedCount = 0;
  let insertedOrUpdated = 0;
  let activeTokenIndex = 0;

  for (const input of inputs) {
    let completed = false;
    let attemptIndex = activeTokenIndex;
    let lastError = null;

    while (!completed && attemptIndex < tokens.length) {
      const token = tokens[attemptIndex];
      try {
        const startedRun = await triggerActorRun(actorId, token, input);
        const completedRun = await waitForRunToFinish(actorId, startedRun.id, token);
        const datasetId = completedRun?.defaultDatasetId;

        if (!datasetId) {
          throw new Error(`No dataset id returned by actor ${actorId}`);
        }

        const rawItems = await fetchDatasetItems(datasetId, token);
        const normalized = rawItems.map((item) => normalizeJob(item, source));
        const cleaned = dedupeJobs(normalized);
        const upsertResult = await upsertJobs(cleaned);

        rawCount += rawItems.length;
        normalizedCount += cleaned.length;
        insertedOrUpdated += upsertResult.inserted;
        runs.push({ runId: completedRun.id, datasetId, input });

        activeTokenIndex = attemptIndex;
        completed = true;
      } catch (error) {
        lastError = error;
        if (isQuotaLikeError(error) && attemptIndex + 1 < tokens.length) {
          attemptIndex += 1;
          continue;
        }
        throw error;
      }
    }

    if (!completed) {
      throw lastError || new Error(`All Apify tokens exhausted for actor ${actorId}`);
    }
  }

  return {
    source,
    actorId,
    runs,
    runId: runs[0]?.runId || '',
    datasetId: runs[0]?.datasetId || '',
    rawCount,
    normalizedCount,
    insertedOrUpdated,
  };
}

export async function ingestJobs(options = {}) {
  const tokens = getApifyTokens(options);
  const upworkActorId = options.upworkActorId || requiredEnv('APIFY_UPWORK_ACTOR_ID');
  const linkedinActorId = options.linkedinActorId || requiredEnv('APIFY_LINKEDIN_ACTOR_ID');
  const useStoredRuns = Boolean(
    options.useStoredRuns
    || /^1|true|yes$/i.test(String(process.env.APIFY_USE_STORED_RUNS || ''))
  );

  const upworkInput = parseActorInput(options.upworkInput || process.env.APIFY_UPWORK_INPUT);
  const linkedinInput = parseActorInput(options.linkedinInput || process.env.APIFY_LINKEDIN_INPUT);
  const upworkDatasetIds = parseDatasetIds(options.upworkDatasetIds || process.env.APIFY_UPWORK_DATASET_IDS);
  const linkedinDatasetIds = parseDatasetIds(options.linkedinDatasetIds || process.env.APIFY_LINKEDIN_DATASET_IDS);
  const upworkActorInputs = buildUpworkActorInputs({
    upworkInput,
    upworkTargets: options.upworkTargets,
  });

  let resolvedUpworkDatasetIds = upworkDatasetIds;
  let resolvedLinkedinDatasetIds = linkedinDatasetIds;

  if (useStoredRuns && !resolvedUpworkDatasetIds.length) {
    const latest = await fetchLatestSuccessfulDatasetId(upworkActorId, tokens);
    if (latest.datasetId) resolvedUpworkDatasetIds = [latest.datasetId];
  }
  if (useStoredRuns && !resolvedLinkedinDatasetIds.length) {
    const latest = await fetchLatestSuccessfulDatasetId(linkedinActorId, tokens);
    if (latest.datasetId) resolvedLinkedinDatasetIds = [latest.datasetId];
  }

  const upwork = resolvedUpworkDatasetIds.length
    ? await ingestFromDatasets({
      source: 'upwork',
      actorId: upworkActorId,
      datasetIds: resolvedUpworkDatasetIds,
      tokens,
    })
    : await ingestFromActor({
      source: 'upwork',
      actorId: upworkActorId,
      actorInput: upworkInput,
      actorInputs: upworkActorInputs,
      tokens,
    });

  const linkedin = resolvedLinkedinDatasetIds.length
    ? await ingestFromDatasets({
      source: 'linkedin',
      actorId: linkedinActorId,
      datasetIds: resolvedLinkedinDatasetIds,
      tokens,
    })
    : await ingestFromActor({
      source: 'linkedin',
      actorId: linkedinActorId,
      actorInput: linkedinInput,
      tokens,
    });

  return {
    ok: true,
    totalRaw: upwork.rawCount + linkedin.rawCount,
    totalNormalized: upwork.normalizedCount + linkedin.normalizedCount,
    insertedOrUpdated: upwork.insertedOrUpdated + linkedin.insertedOrUpdated,
    sources: [
      {
        source: upwork.source,
        actor_id: upwork.actorId,
        run_id: upwork.runId,
        dataset_id: upwork.datasetId,
        runs: upwork.runs,
        raw: upwork.rawCount,
        normalized: upwork.normalizedCount,
        inserted_or_updated: upwork.insertedOrUpdated,
      },
      {
        source: linkedin.source,
        actor_id: linkedin.actorId,
        run_id: linkedin.runId,
        dataset_id: linkedin.datasetId,
        raw: linkedin.rawCount,
        normalized: linkedin.normalizedCount,
        inserted_or_updated: linkedin.insertedOrUpdated,
      },
    ],
  };
}
