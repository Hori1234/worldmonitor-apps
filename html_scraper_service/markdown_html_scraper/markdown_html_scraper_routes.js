import { Router }          from 'express';
import rateLimit           from 'express-rate-limit';
import fs                  from 'fs';
import path                from 'path';
import { spawnSync }       from 'child_process';
import { ZipArchive }      from 'archiver';
import Parser              from 'rss-parser';
import { createJob, getJob, listJobs, cancelJob } from './markdown_html_scraper_jobs.js';
import { getSettings, patchSettings }             from './markdown_html_scraper_settings.js';

const router    = Router();
const rssParser = new Parser();

// ── Rate limiting ─────────────────────────────────────────────────────────────
const scrapeLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scrape requests — try again in a minute' },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOutputDir() {
  return path.resolve(process.env.OUTPUT_DIR || './markdown');
}

function guardPath(relPath) {
  const outputDir = getOutputDir();
  const full = path.resolve(outputDir, relPath);
  if (!full.startsWith(outputDir + path.sep) && full !== outputDir) {
    throw Object.assign(new Error('Access denied'), { status: 403 });
  }
  return full;
}

function buildTree(dir, rootDir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .map((entry) => {
      const full = path.join(dir, entry.name);
      const rel  = path.relative(rootDir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        return { name: entry.name, type: 'dir', path: rel, children: buildTree(full, rootDir) };
      }
      if (entry.name.endsWith('.md')) {
        const stat = fs.statSync(full);
        return { name: entry.name, type: 'file', path: rel, size: stat.size, modifiedAt: stat.mtime.toISOString() };
      }
      return null;
    })
    .filter(Boolean);
}

function validateJobsArray(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return 'Request body must contain a non-empty "jobs" array of { url, category }';
  }
  for (const job of jobs) {
    if (typeof job.url !== 'string' || typeof job.category !== 'string') {
      return 'Each job item must have a "url" (string) and a "category" (string)';
    }
    try { new URL(job.url); } catch { return `Invalid URL: ${job.url}`; }
    if (job.category.trim() === '') return 'Category must not be blank';
  }
  return null;
}

// ── OS Directory Picker (Windows: PowerShell FolderBrowserDialog) ────────────

router.get('/browse-directory', (req, res) => {
  const initial = req.query.initial || '';
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
    '$f.Description = "Select a directory";',
    '$f.ShowNewFolderButton = $true;',
    initial ? `$f.SelectedPath = '${initial.replace(/'/g, "''")}';` : '',
    '$null = $f.ShowDialog();',
    '$f.SelectedPath',
  ].filter(Boolean).join(' ');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], { timeout: 60000 });
  const picked = result.stdout?.toString().trim() || '';
  if (result.error) return res.json({ ok: false, error: result.error.message });
  if (!picked) return res.json({ ok: false, cancelled: true });
  res.json({ ok: true, path: picked });
});

// ── Health ────────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ── Firecrawl key test (server-side proxy to avoid CORS) ───────────────────────

router.post('/test-firecrawl', async (req, res) => {
  const key = req.body?.apiKey || process.env.FIRECRAWL_API_KEY;
  if (!key) {
    return res.json({ ok: false, error: 'No Firecrawl API key is configured on the server' });
  }
  try {
    const r = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
    });
    if (r.ok) {
      res.json({ ok: true, message: 'Firecrawl key is valid ✓' });
    } else {
      const txt = await r.text().catch(() => '');
      res.json({ ok: false, error: `HTTP ${r.status} — ${txt.slice(0, 120)}` });
    }
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────

router.get('/settings', (_req, res) => {
  res.json(getSettings());
});

router.patch('/settings', (req, res) => {
  try {
    patchSettings(req.body ?? {});
    res.json({ ok: true, settings: getSettings() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Scrape ────────────────────────────────────────────────────────────────────

router.post('/scrape', scrapeLimiter, (req, res) => {
  const { jobs, webhookUrl, skipDuplicates } = req.body;
  const err = validateJobsArray(jobs);
  if (err) return res.status(400).json({ error: err });

  const jobId = createJob(jobs, { webhookUrl, skipDuplicates });
  return res.status(202).json({ jobId, status: 'queued', total: jobs.length });
});

router.post('/scrape/feed', scrapeLimiter, async (req, res) => {
  const { feedUrl, category, limit: maxItems } = req.body;
  if (!feedUrl || typeof feedUrl !== 'string') return res.status(400).json({ error: '"feedUrl" is required' });
  if (!category || typeof category !== 'string') return res.status(400).json({ error: '"category" is required' });
  try { new URL(feedUrl); } catch { return res.status(400).json({ error: 'Invalid feedUrl' }); }

  try {
    const feed  = await rssParser.parseURL(feedUrl);
    const items = feed.items
      .slice(0, maxItems ? parseInt(maxItems, 10) : 50)
      .filter((item) => item.link)
      .map((item) => ({ url: item.link, category: category.trim() }));

    if (items.length === 0) return res.status(422).json({ error: 'Feed contained no usable article links' });

    const jobId = createJob(items, req.body);
    return res.status(202).json({ jobId, status: 'queued', total: items.length, feedTitle: feed.title || feedUrl });
  } catch (err) {
    return res.status(502).json({ error: `Could not fetch feed: ${err.message}` });
  }
});

// ── Jobs ──────────────────────────────────────────────────────────────────────

router.get('/jobs', (_req, res) => {
  res.json({ jobs: listJobs() });
});

router.get('/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or has expired' });
  return res.json(job);
});

router.delete('/jobs/:jobId', (req, res) => {
  const ok = cancelJob(req.params.jobId);
  if (!ok) return res.status(404).json({ error: 'Job not found or has expired' });
  return res.json({ ok: true, jobId: req.params.jobId, status: 'cancelled' });
});

router.get('/jobs/:jobId/events', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or has expired' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send(job);
  if (['completed', 'failed', 'cancelled'].includes(job.status)) { res.end(); return; }

  const interval = setInterval(() => {
    const current = getJob(req.params.jobId);
    if (!current) { clearInterval(interval); res.end(); return; }
    send(current);
    if (['completed', 'failed', 'cancelled'].includes(current.status)) { clearInterval(interval); res.end(); }
  }, 1000);

  req.on('close', () => clearInterval(interval));
});

// ── Markdown file tree ────────────────────────────────────────────────────────

router.get('/markdown/tree', (_req, res) => {
  const outputDir = getOutputDir();
  if (!fs.existsSync(outputDir)) return res.json({ tree: [] });
  try { res.json({ tree: buildTree(outputDir, outputDir) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Markdown full-text search ─────────────────────────────────────────────────

router.get('/markdown/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.status(400).json({ error: '"q" query param is required' });
  const outputDir = getOutputDir();
  if (!fs.existsSync(outputDir)) return res.json({ results: [] });

  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.md')) continue;
      const content = fs.readFileSync(full, 'utf-8');
      if (!content.toLowerCase().includes(q)) continue;
      const rel    = path.relative(outputDir, full).replace(/\\/g, '/');
      const lines  = content.split('\n');
      const lineIdx = lines.findIndex((l) => l.toLowerCase().includes(q));
      results.push({ path: rel, name: entry.name, excerpt: lineIdx >= 0 ? lines[lineIdx].trim().slice(0, 200) : '', line: lineIdx + 1 });
    }
  }
  try { walk(outputDir); res.json({ results, total: results.length }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Markdown file CRUD ────────────────────────────────────────────────────────

router.get('/markdown/file', (req, res) => {
  try {
    const fullPath = guardPath(req.query.path || '');
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return res.status(404).json({ error: 'File not found' });
    res.type('text/plain; charset=utf-8').send(fs.readFileSync(fullPath, 'utf-8'));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.put('/markdown/file', (req, res) => {
  try {
    const fullPath = guardPath(req.query.path || '');
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    if (typeof req.body.content !== 'string') return res.status(400).json({ error: '"content" string is required' });
    fs.writeFileSync(fullPath, req.body.content, 'utf-8');
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.patch('/markdown/file', (req, res) => {
  try {
    const src  = guardPath(req.body.path || '');
    const dest = guardPath(req.body.newPath || '');
    if (!fs.existsSync(src)) return res.status(404).json({ error: 'File not found' });
    if (fs.existsSync(dest)) return res.status(409).json({ error: 'Destination already exists' });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
    res.json({ ok: true, path: path.relative(getOutputDir(), dest).replace(/\\/g, '/') });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.delete('/markdown/file', (req, res) => {
  try {
    const fullPath = guardPath(req.query.path || '');
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(fullPath);
    res.json({ ok: true });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.get('/markdown/meta', (req, res) => {
  try {
    const fullPath = guardPath(req.query.path || '');
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return res.status(404).json({ error: 'File not found' });
    const content  = fs.readFileSync(fullPath, 'utf-8');
    const stat     = fs.statSync(fullPath);
    const body     = content.replace(/^---[\s\S]*?---\n/, '');
    const words    = body.trim().split(/\s+/).length;
    const readingMin = Math.max(1, Math.round(words / 200));
    const fmMatch  = content.match(/^---\n([\s\S]*?)\n---/);
    const meta     = {};
    if (fmMatch) {
      for (const line of fmMatch[1].split('\n')) {
        const eqIdx = line.indexOf(':');
        if (eqIdx === -1) continue;
        const k = line.slice(0, eqIdx).trim();
        const v = line.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
        if (k) meta[k] = v;
      }
    }
    res.json({ size: stat.size, modifiedAt: stat.mtime.toISOString(), wordCount: words, readingMinutes: readingMin, ...meta });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── Category management ───────────────────────────────────────────────────────

router.get('/markdown/categories', (_req, res) => {
  const outputDir = getOutputDir();
  if (!fs.existsSync(outputDir)) return res.json({ categories: [] });
  const cats = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, files: fs.readdirSync(path.join(outputDir, e.name)).filter((f) => f.endsWith('.md')).length }));
  res.json({ categories: cats });
});

router.post('/markdown/categories', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: '"name" is required' });
  if (/[/\\?%*:|"<>]/.test(name)) return res.status(400).json({ error: 'Invalid category name' });
  const dir = path.join(getOutputDir(), name);
  if (fs.existsSync(dir)) return res.status(409).json({ error: 'Category already exists' });
  fs.mkdirSync(dir, { recursive: true });
  res.status(201).json({ ok: true, name });
});

router.patch('/markdown/categories/:name', (req, res) => {
  const outputDir = getOutputDir();
  const src     = path.join(outputDir, req.params.name);
  const newName = (req.body.newName || '').trim();
  if (!newName) return res.status(400).json({ error: '"newName" is required' });
  if (!fs.existsSync(src)) return res.status(404).json({ error: 'Category not found' });
  const dest = path.join(outputDir, newName);
  if (fs.existsSync(dest)) return res.status(409).json({ error: 'Name already taken' });
  fs.renameSync(src, dest);
  res.json({ ok: true, name: newName });
});

router.delete('/markdown/categories/:name', (req, res) => {
  const outputDir = getOutputDir();
  const dir = path.join(outputDir, req.params.name);
  if (!dir.startsWith(outputDir + path.sep)) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Category not found' });
  fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

// ── Export as zip ─────────────────────────────────────────────────────────────

router.get('/export', (req, res) => {
  const outputDir = getOutputDir();
  if (!fs.existsSync(outputDir)) return res.status(404).json({ error: 'No markdown files found' });
  const category = req.query.category;
  const srcDir   = category ? path.join(outputDir, category) : outputDir;
  if (!srcDir.startsWith(outputDir)) return res.status(403).json({ error: 'Access denied' });
  if (!fs.existsSync(srcDir)) return res.status(404).json({ error: 'Category not found' });

  const zipName = category ? `${category}.zip` : 'markdown-export.zip';
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  res.setHeader('Content-Type', 'application/zip');

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  archive.pipe(res);
  archive.directory(srcDir, category || false);
  archive.finalize();
});

export default router;
