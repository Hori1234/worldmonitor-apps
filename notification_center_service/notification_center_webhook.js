/**
 * notification_center_webhook.js
 * Fires HTTP webhooks for edge rule actions.
 */

import { settings } from './notification_center_settings.js';

/** Replace {{variable}} placeholders in a template string. Supports {{#field}} as payload shorthand. */
function renderTemplate(template, ctx) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    if (trimmed.startsWith('#')) {
      // {{#field}} → ctx.payload[field] (shorthand for connected-input payload fields)
      const field = trimmed.slice(1);
      return String(ctx.payload?.[field] ?? ctx.lastIcm?.[field] ?? '');
    }
    const parts = trimmed.split('.');
    let val = ctx;
    for (const p of parts) val = val?.[p];
    return String(val ?? '');
  });
}

/**
 * @param {object} action   - Edge rule webhook action config
 * @param {object} context  - Template variable values
 */
export async function fireWebhook(action, context) {
  if (!action.url) {
    console.warn('[nc-webhook] No URL configured for webhook action');
    return;
  }

  const body = renderTemplate(action.bodyTemplate ?? '', context);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(action.url, {
      method:  action.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(action.headers ?? {}),
      },
      body,
      signal: controller.signal,
    });
    console.log(`[nc-webhook] ${action.method ?? 'POST'} ${action.url} → ${res.status}`);
  } catch (e) {
    console.error(`[nc-webhook] Failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}
