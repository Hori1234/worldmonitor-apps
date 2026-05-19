/**
 * notification_center_email.js
 * Sends emails via nodemailer for edge rule actions.
 * When SMTP is not configured, logs to console instead.
 */

import nodemailer from 'nodemailer';
import { settings } from './notification_center_settings.js';

let _transport = null;

function getTransport() {
  if (_transport) return _transport;
  if (!settings.EMAIL_SMTP_HOST) return null;
  _transport = nodemailer.createTransport({
    host:   settings.EMAIL_SMTP_HOST,
    port:   settings.EMAIL_SMTP_PORT,
    secure: settings.EMAIL_SMTP_PORT === 465,
    auth: {
      user: settings.EMAIL_SMTP_USER,
      pass: settings.EMAIL_SMTP_PASS,
    },
  });
  return _transport;
}

/**
 * @param {object} action   - Edge rule email action config
 * @param {object} context  - Template variable values
 */
export async function sendEmail(action, context) {
  const subject = renderTemplate(action.subject ?? '', context);
  const body    = renderTemplate(action.bodyTemplate ?? '', context);

  const transport = getTransport();
  if (!transport) {
    console.log(`[nc-email] (no SMTP configured) Would send to: ${(action.to ?? []).join(', ')}`);
    console.log(`[nc-email]   Subject: ${subject}`);
    console.log(`[nc-email]   Body:    ${body}`);
    return;
  }

  await transport.sendMail({
    from:    settings.EMAIL_FROM,
    to:      (action.to ?? []).join(', '),
    subject,
    text:    body,
  });
  console.log(`[nc-email] Sent to: ${(action.to ?? []).join(', ')} — "${subject}"`);
}

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
