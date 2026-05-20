// Scraper Service API endpoint definitions
// Paths are relative — the urlPrefix '/api' is prepended by the explorer factory.

export const SCRAPER_ENDPOINTS = [
  // ── Health ──────────────────────────────────────────────
  {
    group: 'Health', method: 'GET', path: '/health',
    desc: 'Liveness probe — verify the server is running.',
  },

  // ── Scrape ──────────────────────────────────────────────
  {
    group: 'Scrape', method: 'POST', path: '/scrape',
    desc: 'Submit a batch of URLs to scrape. Returns a jobId immediately.',
    body: JSON.stringify({
      jobs: [{ url: 'https://example.com/article', category: 'Technology' }],
      webhookUrl: '',
      skipDuplicates: false,
    }, null, 2),
  },
  {
    group: 'Scrape', method: 'POST', path: '/scrape/feed',
    desc: 'Parse an RSS/Atom feed and create a scrape job from its items (max 50).',
    body: JSON.stringify({
      feedUrl: 'https://feeds.feedburner.com/TechCrunch',
      category: 'Technology',
      skipDuplicates: true,
    }, null, 2),
  },

  // ── Jobs ────────────────────────────────────────────────
  {
    group: 'Jobs', method: 'GET', path: '/jobs',
    desc: 'List all jobs (active, completed, and failed).',
  },
  {
    group: 'Jobs', method: 'GET', path: '/jobs/:jobId',
    desc: 'Get the status and results of a specific job.',
    pathParams: [{ name: 'jobId', default: '' }],
  },
  {
    group: 'Jobs', method: 'DELETE', path: '/jobs/:jobId',
    desc: 'Cancel a running or queued job.',
    pathParams: [{ name: 'jobId', default: '' }],
  },
  {
    group: 'Jobs', method: 'SSE', path: '/jobs/:jobId/events',
    desc: 'Server-Sent Events stream for real-time job progress.',
    pathParams: [{ name: 'jobId', default: '' }],
  },

  // ── Markdown Files ───────────────────────────────────────
  {
    group: 'Markdown', method: 'GET', path: '/markdown/tree',
    desc: 'Returns the full directory tree with file size and modifiedAt per node.',
  },
  {
    group: 'Markdown', method: 'GET', path: '/markdown/search',
    desc: 'Full-text search across all markdown files. Returns matching lines with excerpts.',
    queryParams: [{ name: 'q', default: '', desc: 'Search query' }],
  },
  {
    group: 'Markdown', method: 'GET', path: '/markdown/file',
    desc: 'Get raw markdown content of a single file.',
    queryParams: [{ name: 'path', default: '', desc: 'Relative path from output dir' }],
  },
  {
    group: 'Markdown', method: 'PUT', path: '/markdown/file',
    desc: 'Overwrite the content of an existing markdown file.',
    queryParams: [{ name: 'path', default: '', desc: 'Relative path from output dir' }],
    body: JSON.stringify({ content: '# My Article\n\nUpdated content here.' }, null, 2),
  },
  {
    group: 'Markdown', method: 'PATCH', path: '/markdown/file',
    desc: 'Rename or move a markdown file.',
    body: JSON.stringify({ path: 'Technology/old-name.md', newPath: 'Technology/new-name.md' }, null, 2),
  },
  {
    group: 'Markdown', method: 'DELETE', path: '/markdown/file',
    desc: 'Permanently delete a markdown file.',
    queryParams: [{ name: 'path', default: '', desc: 'Relative path from output dir' }],
  },
  {
    group: 'Markdown', method: 'GET', path: '/markdown/meta',
    desc: 'Returns wordCount, readingMinutes, and all YAML front matter fields.',
    queryParams: [{ name: 'path', default: '', desc: 'Relative path from output dir' }],
  },

  // ── Categories ───────────────────────────────────────────
  {
    group: 'Categories', method: 'GET', path: '/markdown/categories',
    desc: 'List all category directories with their file counts.',
  },
  {
    group: 'Categories', method: 'POST', path: '/markdown/categories',
    desc: 'Create a new category folder.',
    body: JSON.stringify({ name: 'NewCategory' }, null, 2),
  },
  {
    group: 'Categories', method: 'PATCH', path: '/markdown/categories/:name',
    desc: 'Rename an existing category folder.',
    pathParams: [{ name: 'name', default: '' }],
    body: JSON.stringify({ newName: 'RenamedCategory' }, null, 2),
  },
  {
    group: 'Categories', method: 'DELETE', path: '/markdown/categories/:name',
    desc: 'Delete a category and all its markdown files. Irreversible.',
    pathParams: [{ name: 'name', default: '' }],
  },

  // ── Export ───────────────────────────────────────────────
  {
    group: 'Export', method: 'GET', path: '/export',
    desc: "Download all (or a single category's) markdown files as a ZIP archive.",
    queryParams: [{ name: 'category', default: '', desc: 'Filter to one category (optional)' }],
  },

  // ── Settings ─────────────────────────────────────────────
  {
    group: 'Settings', method: 'GET', path: '/settings',
    desc: 'Read all current server settings. API key is masked.',
  },
  {
    group: 'Settings', method: 'PATCH', path: '/settings',
    desc: 'Hot-apply setting changes and rewrite .env. Only send keys you want to change.',
    body: JSON.stringify({ MAX_CONCURRENCY: '3', MAX_RETRIES: '1', LOG_LEVEL: 'info' }, null, 2),
  },
];
