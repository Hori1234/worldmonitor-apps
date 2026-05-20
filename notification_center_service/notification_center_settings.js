/**
 * notification_center_settings.js
 * Reads configuration from environment variables (via dotenv).
 */

export const settings = {
  PORT:              parseInt(process.env.PORT             ?? '3003', 10),
  MAX_STORED:        parseInt(process.env.MAX_STORED        ?? '500',  10),
  RETENTION_DAYS:    parseInt(process.env.RETENTION_DAYS    ?? '7',    10),
  EDGE_RULES_PERSIST: process.env.EDGE_RULES_PERSIST !== 'false',
  PROFILES_PERSIST:   process.env.PROFILES_PERSIST   !== 'false',
  PROFILES_DATA_DIR:  process.env.PROFILES_DATA_DIR  ?? './data/profiles',
  RULES_DATA_DIR:     process.env.RULES_DATA_DIR     ?? './data/edge-rules',
  EMAIL_SMTP_HOST:    process.env.EMAIL_SMTP_HOST     ?? '',
  EMAIL_SMTP_PORT:    parseInt(process.env.EMAIL_SMTP_PORT  ?? '587',  10),
  EMAIL_SMTP_USER:    process.env.EMAIL_SMTP_USER     ?? '',
  EMAIL_SMTP_PASS:    process.env.EMAIL_SMTP_PASS     ?? '',
  EMAIL_FROM:         process.env.EMAIL_FROM          ?? '',
  WEBHOOK_TIMEOUT_MS: parseInt(process.env.WEBHOOK_TIMEOUT_MS ?? '5000', 10),
  ICM_FORWARD_WS:     process.env.ICM_FORWARD_WS === 'true',
};
