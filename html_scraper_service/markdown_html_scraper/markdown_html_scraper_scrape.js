import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import fs from 'fs';
import path from 'path';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// Common cookie consent button texts (ordered by specificity)
const COOKIE_BUTTON_TEXTS = [
  'Accept all',
  'Accept All',
  'Accept all cookies',
  'Accept All Cookies',
  'Accept cookies',
  'Accept Cookies',
  'I accept',
  'I Accept',
  'I agree',
  'I Agree',
  'Agree',
  'Allow all',
  'Allow All',
  'Allow all cookies',
  'Got it',
  'OK',
  'Okay',
  'Continue',
];

// ---------------------------------------------------------------------------
// Content-quality guards
// Patterns that indicate we got an error page or undismissed consent wall
// instead of actual article content.
// ---------------------------------------------------------------------------

const ERROR_TITLE_PATTERNS = [
  /page not found/i,
  /\b404\b/,
  /not found/i,
  /access denied/i,
  /403 forbidden/i,
  /error \d{3}/i,
  /something went wrong/i,
  /oops/i,
  /site unavailable/i,
];

// Keywords that cluster heavily in consent / GDPR walls
const CONSENT_KEYWORDS = [
  'personal data',
  'legitimate interest',
  'gdpr',
  'cookie policy',
  'we and our partners',
  'your privacy',
  'data processing',
  'advertising and content',
  'store and/or access',
  'consent to use',
];

const MIN_ARTICLE_WORDS = 80;

/**
 * Core validator — works on any (title, text) pair.
 * Throws a descriptive error if the content looks like an error page,
 * a consent / cookie wall, or is too short to be a real article.
 */
function validateContent(title, text) {
  const cleanTitle = (title || '').trim();
  const wordCount = text.trim().split(/\s+/).length;
  const lowerText = text.toLowerCase();

  // 1. Error-page title
  for (const pattern of ERROR_TITLE_PATTERNS) {
    if (pattern.test(cleanTitle)) {
      throw new Error(`Error page detected: "${cleanTitle}"`);
    }
  }

  // 2. Consent / cookie wall — high keyword density in short content
  const consentHits = CONSENT_KEYWORDS.filter((kw) => lowerText.includes(kw)).length;
  if (consentHits >= 3 && wordCount < 600) {
    throw new Error(
      `Consent/cookie wall detected (${consentHits} consent signals, only ${wordCount} words)`,
    );
  }

  // 3. Content is too short to be an article
  if (wordCount < MIN_ARTICLE_WORDS) {
    throw new Error(
      `Content too short to be an article (${wordCount} words, minimum ${MIN_ARTICLE_WORDS})`,
    );
  }
}

/** Playwright-specific wrapper — pulls title and plain text from Readability output. */
function validateExtractedContent(article) {
  validateContent(article.title, article.textContent || '');
}

// Known cookie banner element selectors
const COOKIE_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#accept-recommended-btn-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '.cc-accept',
  '.cc-btn.cc-allow',
  '[data-cookiebanner="accept_button"]',
  '[aria-label*="Accept cookies" i]',
  '[aria-label*="Accept all" i]',
  '#gdpr-consent-notice button:first-of-type',
  '.consent-bumper__btn-primary',
];

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    const launchOptions = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
    if (process.env.PROXY_URL) {
      launchOptions.proxy = { server: process.env.PROXY_URL };
    }
    browserInstance = await chromium.launch(launchOptions);
  }
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore errors on close
    }
    browserInstance = null;
  }
}

async function dismissCookieConsent(page) {
  // Try role-based text matching first (most portable across sites)
  for (const text of COOKIE_BUTTON_TEXTS) {
    try {
      const btn = page.getByRole('button', { name: text, exact: true });
      if ((await btn.count()) > 0) {
        await btn.first().click({ timeout: 2000 });
        await page.waitForTimeout(600);
        return true;
      }
    } catch {
      // Try next
    }
  }

  // Try known vendor-specific selectors
  for (const selector of COOKIE_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el && (await el.isVisible())) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(600);
        return true;
      }
    } catch {
      // Try next
    }
  }

  // Last resort: press Escape to dismiss modal-style banners
  try {
    await page.keyboard.press('Escape');
  } catch {
    // Ignore
  }

  return false;
}

/**
 * Scrape a URL using Playwright + Readability.
 * Handles cookie consent popups before extracting content.
 */
export async function scrapeWithPlaywright(url) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  try {
    const timeout = parseInt(process.env.BROWSER_TIMEOUT || '30000', 10);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    // Dismiss cookie/consent popups
    await dismissCookieConsent(page);

    // Let any lazy-loaded content settle
    await page.waitForTimeout(1000);

    // Try to wait for body content (best effort)
    try {
      await page.waitForSelector('article, main, [role="main"], .article-body', {
        timeout: 5000,
      });
    } catch {
      // Continue even if no semantic article element is found
    }

    const html = await page.content();

    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article || !article.content) {
      throw new Error('Readability could not extract article content');
    }

    // Reject consent walls, 404 pages, and stub content before writing anything
    validateExtractedContent(article);

    const markdown = turndownService.turndown(article.content);

    return {
      title: article.title || 'Untitled',
      markdown: `# ${article.title}\n\n${markdown}`,
      method: 'playwright',
    };
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * Scrape a URL using the Firecrawl API.
 * Used as fallback when Playwright fails.
 */
export async function scrapeWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY is not configured — cannot use Firecrawl fallback');
  }

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl API error (${response.status}): ${text}`);
  }

  const data = await response.json();

  if (!data.success || !data.data?.markdown) {
    throw new Error('Firecrawl returned no markdown content');
  }

  const title = data.data.metadata?.title || new URL(url).hostname;
  const markdown = data.data.markdown;

  // Apply the same quality checks as Playwright so bad pages don't slip through
  validateContent(title, markdown);

  return {
    title,
    markdown,
    method: 'firecrawl',
  };
}

function sanitizeFilename(name) {
  return name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 120)
    .replace(/-+$/, ''); // trim trailing dashes
}

/**
 * Scrape a URL, save to markdown/{category}/{title}.md.
 * Tries Playwright first, falls back to Firecrawl.
 */
export async function scrapeUrl(url, category, outputDir) {
  let result;
  let playwrightError = null;

  try {
    result = await scrapeWithPlaywright(url);
  } catch (err) {
    playwrightError = err.message;
    console.warn(`[scraper] Playwright failed for ${url}: ${err.message} — falling back to Firecrawl`);
    result = await scrapeWithFirecrawl(url);
  }

  const categoryDir = path.join(outputDir, sanitizeFilename(category));
  fs.mkdirSync(categoryDir, { recursive: true });

  const filename = `${sanitizeFilename(result.title)}.md`;
  const filePath = path.join(categoryDir, filename);

  // Build YAML front matter
  const wordCount = result.markdown.trim().split(/\s+/).length;
  const frontMatter = [
    '---',
    `url: "${url}"`,
    `title: "${result.title.replace(/"/g, "'")}"`,
    `category: "${category}"`,
    `scraped_at: "${new Date().toISOString()}"`,
    `method: "${result.method}"`,
    `word_count: ${wordCount}`,
    '---',
    '',
  ].join('\n');

  fs.writeFileSync(filePath, frontMatter + result.markdown, 'utf-8');

  const relativeFile = path.relative(outputDir, filePath).replace(/\\/g, '/');

  return {
    url,
    category,
    title: result.title,
    file: relativeFile,
    method: result.method,
    wordCount,
    ...(playwrightError ? { playwrightFallbackReason: playwrightError } : {}),
  };
}
