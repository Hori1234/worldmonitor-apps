import pLimit from 'p-limit';
import path from 'path';
import { scrapeUrl } from './markdown_html_scraper_scrape.js';

// ── Stores ────────────────────────────────────────────────────────────────────

/** Primary job store: jobId → Job */
const jobs = new Map();

/** Cancelled job IDs — checked inside processing loop */
const cancelledJobs = new Set();

/**
 * Cross-job duplicate detection: url → { file, scrapedAt }
 * Cleared when the server restarts.
 */
const scrapedUrlIndex = new Map();

/** Subscribers for real-time push (WebSocket broadcast fn, set from index.js) */
let broadcastFn = null;

export function setBroadcast(fn) { broadcastFn = fn; }

function emit(event) {
  if (broadcastFn) broadcastFn(event);
}

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create and enqueue a new scrape job.
 * @param {Array<{url:string, category:string}>} items
 * @param {{ webhookUrl?: string, skipDuplicates?: boolean }} [opts]
 * @returns {string} jobId
 */
export function createJob(items, opts = {}) {
  const jobId    = crypto.randomUUID();
  const outputDir = path.resolve(process.env.OUTPUT_DIR || './markdown');

  const job = {
    id: jobId,
    status: 'queued',
    total: items.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    webhookUrl: opts.webhookUrl || null,
    skipDuplicates: opts.skipDuplicates ?? false,
  };

  jobs.set(jobId, job);
  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);

  processJob(jobId, items, outputDir).catch((err) => {
    const j = jobs.get(jobId);
    if (j) {
      j.status = 'failed';
      j.updatedAt = new Date().toISOString();
      console.error(`[jobQueue] Job ${jobId} failed:`, err.message);
    }
  });

  return jobId;
}

/** Retrieve a job by ID. */
export function getJob(jobId) {
  return jobs.get(jobId) ?? null;
}

/** List all jobs (newest first). */
export function listJobs() {
  return [...jobs.values()].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
}

/**
 * Cancel a queued or running job.
 * In-flight scrapeUrl calls finish naturally; pending tasks are skipped.
 */
export function cancelJob(jobId) {
  cancelledJobs.add(jobId);
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.status === 'queued' || job.status === 'running') {
    job.status = 'cancelled';
    job.updatedAt = new Date().toISOString();
    emit({ type: 'job:cancelled', jobId });
  }
  return true;
}

// ── Internals ─────────────────────────────────────────────────────────────────

async function scrapeWithRetry(url, category, outputDir, maxRetries) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await scrapeUrl(url, category, outputDir);
    } catch (err) {
      lastError = err;
      if (attempt <= maxRetries) {
        const delay = 1000 * attempt;
        console.warn(`[jobQueue] Retry ${attempt}/${maxRetries} for ${url} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

async function processJob(jobId, items, outputDir) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.status = 'running';
  job.updatedAt = new Date().toISOString();
  emit({ type: 'job:started', jobId });

  const concurrency = parseInt(process.env.MAX_CONCURRENCY || '3', 10);
  const maxRetries  = parseInt(process.env.MAX_RETRIES  || '1', 10);
  const limit       = pLimit(concurrency);

  const tasks = items.map(({ url, category }) =>
    limit(async () => {
      // Respect cancellation
      if (cancelledJobs.has(jobId)) {
        job.skipped += 1;
        job.results.push({ status: 'skipped', url, category, reason: 'job cancelled' });
        job.updatedAt = new Date().toISOString();
        return;
      }

      // Duplicate detection
      if (job.skipDuplicates && scrapedUrlIndex.has(url)) {
        const prev = scrapedUrlIndex.get(url);
        job.skipped += 1;
        job.results.push({ status: 'skipped', url, category, reason: 'duplicate', previousFile: prev.file });
        job.updatedAt = new Date().toISOString();
        console.log(`[jobQueue] [${jobId}] SKIP (duplicate) ${url}`);
        emit({ type: 'job:item-skipped', jobId, url, reason: 'duplicate' });
        return;
      }

      try {
        const result = await scrapeWithRetry(url, category, outputDir, maxRetries);
        job.completed += 1;
        job.results.push({ status: 'success', ...result });
        scrapedUrlIndex.set(url, { file: result.file, scrapedAt: new Date().toISOString() });
        console.log(`[jobQueue] [${jobId}] OK  (${job.completed}/${job.total}) ${url}`);
        emit({ type: 'job:item-done', jobId, url, file: result.file });
      } catch (err) {
        job.failed += 1;
        job.results.push({ status: 'failed', url, category, error: err.message });
        console.error(`[jobQueue] [${jobId}] ERR (${job.failed} failed) ${url}: ${err.message}`);
        emit({ type: 'job:item-error', jobId, url, error: err.message });
      }
      job.updatedAt = new Date().toISOString();
    }),
  );

  await Promise.allSettled(tasks);

  if (!cancelledJobs.has(jobId)) {
    job.status = 'completed';
  }
  job.updatedAt = new Date().toISOString();
  cancelledJobs.delete(jobId);
  console.log(`[jobQueue] Job ${jobId} ${job.status} — ${job.completed} ok, ${job.failed} failed, ${job.skipped} skipped`);
  emit({ type: 'job:completed', jobId, status: job.status, completed: job.completed, failed: job.failed, skipped: job.skipped });

  // Fire webhook if configured
  if (job.webhookUrl) {
    fireWebhook(job.webhookUrl, job).catch((err) =>
      console.warn(`[jobQueue] Webhook failed for job ${jobId}:`, err.message),
    );
  }
}

async function fireWebhook(webhookUrl, job) {
  // Validate that it looks like a real URL before sending
  new URL(webhookUrl);
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId: job.id,
      status: job.status,
      completed: job.completed,
      failed: job.failed,
      skipped: job.skipped,
      results: job.results,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  console.log(`[jobQueue] Webhook delivered → ${webhookUrl} (${res.status})`);
}
