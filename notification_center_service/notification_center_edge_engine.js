/**
 * notification_center_edge_engine.js
 * Edge Rule store + rolling-window evaluation engine.
 *
 * Rules are evaluated on every ICM emitted on the '*' channel.
 * When threshold.count ICMs matching a rule fire within threshold.windowMs,
 * all rule actions are dispatched and (if resetAfterFire) the counter resets.
 */

import fs   from 'node:fs';
import path from 'node:path';
import { onICM }          from './notification_center_icm.js';
import { sendEmail }      from './notification_center_email.js';
import { fireWebhook }    from './notification_center_webhook.js';
import { settings }       from './notification_center_settings.js';

// ── State ─────────────────────────────────────────────────────────────────────

let rules = [];                           // EdgeRule[]
const counters = new Map();               // ruleId → number[]  (timestamps)

// ── Persistence ───────────────────────────────────────────────────────────────

const rulesDir = () => path.resolve(settings.RULES_DATA_DIR);

export function loadRules() {
  try {
    fs.mkdirSync(rulesDir(), { recursive: true });
    rules = fs.readdirSync(rulesDir())
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try { return JSON.parse(fs.readFileSync(path.join(rulesDir(), f), 'utf8')); }
        catch { return null; }
      })
      .filter(Boolean);
    console.log(`[nc-edge] Loaded ${rules.length} edge rule(s)`);
  } catch { rules = []; }
}

function saveRule(rule) {
  if (!settings.EDGE_RULES_PERSIST) return;
  fs.mkdirSync(rulesDir(), { recursive: true });
  fs.writeFileSync(path.join(rulesDir(), `${rule.id}.json`), JSON.stringify(rule, null, 2));
}

function deleteRuleFile(id) {
  const f = path.join(rulesDir(), `${id}.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function listRules() { return rules; }

export function getRule(id) { return rules.find((r) => r.id === id) ?? null; }

export function createRule(data) {
  const now  = new Date().toISOString();
  const rule = {
    id:          crypto.randomUUID(),
    name:        data.name        ?? 'Unnamed rule',
    enabled:     data.enabled     ?? true,
    description: data.description ?? '',
    trigger: {
      icmType: data.trigger?.icmType ?? '*',
      filter:  data.trigger?.filter  ?? null,
      inputConditions: data.trigger?.inputConditions ?? [],
      threshold: {
        count:          data.trigger?.threshold?.count          ?? 1,
        windowMs:       data.trigger?.threshold?.windowMs       ?? 60000,
        resetAfterFire: data.trigger?.threshold?.resetAfterFire ?? true,
      },
    },
    actions:   Array.isArray(data.actions) ? data.actions : [],
    createdAt: now,
    updatedAt: now,
  };
  rules.push(rule);
  saveRule(rule);
  return rule;
}

export function updateRule(id, data) {
  const rule = rules.find((r) => r.id === id);
  if (!rule) return null;
  if (data.name        !== undefined) rule.name        = data.name;
  if (data.description !== undefined) rule.description = data.description;
  if (data.enabled     !== undefined) rule.enabled     = data.enabled;
  if (data.trigger     !== undefined) {
    rule.trigger.icmType = data.trigger.icmType ?? rule.trigger.icmType;
    if (data.trigger.filter           !== undefined) rule.trigger.filter           = data.trigger.filter;
    if (data.trigger.inputConditions  !== undefined) rule.trigger.inputConditions  = data.trigger.inputConditions;
    if (data.trigger.threshold) {
      Object.assign(rule.trigger.threshold, data.trigger.threshold);
    }
  }
  if (Array.isArray(data.actions)) rule.actions = data.actions;
  rule.updatedAt = new Date().toISOString();
  saveRule(rule);
  return rule;
}

export function deleteRule(id) {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  rules.splice(idx, 1);
  counters.delete(id);
  deleteRuleFile(id);
  return true;
}

export function toggleRule(id, enabled) {
  return updateRule(id, { enabled });
}

// ── Evaluation ────────────────────────────────────────────────────────────────

/** Evaluate a single filter clause against an ICM. */
function matchFilter(filter, icm) {
  if (!filter) return true;
  const { field, operator, value } = filter;
  const actual = icm[field];
  switch (operator) {
    case 'eq':       return String(actual) === String(value);
    case 'neq':      return String(actual) !== String(value);
    case 'gt':       return Number(actual)  >  Number(value);
    case 'lt':       return Number(actual)  <  Number(value);
    case 'gte':      return Number(actual)  >= Number(value);
    case 'lte':      return Number(actual)  <= Number(value);
    case 'contains': return String(actual).toLowerCase().includes(String(value).toLowerCase());
    case 'regex':    try { return new RegExp(value).test(String(actual)); } catch { return false; }
    default:         return true;
  }
}

/**
 * Validate all inputConditions groups from a rule against an ICM payload.
 * All conditions across all groups must pass (AND logic).
 */
function validateInputConditions(rule, icm) {
  const groups = rule.trigger?.inputConditions ?? [];
  if (!groups.length) return true;
  for (const group of groups) {
    for (const cond of (group.conditions ?? [])) {
      if (!matchFilter({ field: cond.field, operator: cond.operator, value: cond.value }, icm)) return false;
    }
  }
  return true;
}

/** Build the template context passed to action executors. */
function buildContext(rule, matchedTimestamps, lastICM) {
  return {
    count:       matchedTimestamps.length,
    windowStart: new Date(Math.min(...matchedTimestamps)).toISOString(),
    windowEnd:   new Date(Math.max(...matchedTimestamps)).toISOString(),
    icmType:     lastICM.icmType,
    ruleName:    rule.name,
    lastIcm:     lastICM,
    payload:     { ...lastICM }, // flat copy — enables {{#field}} shorthand in templates
  };
}

/** Fire all actions for a rule. */
async function fireActions(rule, context, broadcast) {
  console.log(`[nc-edge] Rule fired: "${rule.name}" (${rule.trigger.icmType})`);
  const firedEvent = {
    type:      'edge-rule:fired',
    ruleId:    rule.id,
    ruleName:  rule.name,
    icmType:   rule.trigger.icmType,
    count:     context.count,
    timestamp: new Date().toISOString(),
  };
  if (broadcast) broadcast('edge-rule:fired', firedEvent);

  for (const action of rule.actions) {
    try {
      if (action.actionType === 'email')   await sendEmail(action, context);
      if (action.actionType === 'webhook') await fireWebhook(action, context);
    } catch (e) {
      console.error(`[nc-edge] Action error (${action.actionType}):`, e.message);
    }
  }
}

/** Called on every ICM. Evaluates all enabled rules. */
export function evaluateICM(icm, broadcast) {
  const now = Date.now();

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // ICM type match
    if (rule.trigger.icmType !== '*' && rule.trigger.icmType !== icm.icmType) continue;

    // Filter match
    if (!matchFilter(rule.trigger.filter, icm)) continue;

    // Input conditions match (AND across all connected-input condition groups)
    if (!validateInputConditions(rule, icm)) continue;

    // Rolling window counter
    const windowMs = rule.trigger.threshold.windowMs ?? 60000;
    const needed   = rule.trigger.threshold.count    ?? 1;
    let   ts       = counters.get(rule.id) ?? [];

    // Drop expired timestamps
    ts = ts.filter((t) => now - t <= windowMs);
    ts.push(now);
    counters.set(rule.id, ts);

    if (ts.length >= needed) {
      const ctx = buildContext(rule, ts, icm);
      fireActions(rule, ctx, broadcast);
      if (rule.trigger.threshold.resetAfterFire) counters.set(rule.id, []);
    }
  }
}

// ── Test endpoint helper ──────────────────────────────────────────────────────

/** Simulate an ICM against a specific rule; actually fires actions when threshold is met. */
export async function testRule(ruleId, icmPayload) {
  const rule = getRule(ruleId);
  if (!rule) return { ok: false, error: 'Rule not found' };

  const log = [];
  const now  = Date.now();

  const icmTypeMatch = rule.trigger.icmType === '*' || rule.trigger.icmType === icmPayload.icmType;
  log.push({ ts: new Date().toISOString(), msg: `ICM type match: ${icmTypeMatch}` });

  const filterMatch = matchFilter(rule.trigger.filter, icmPayload);
  log.push({ ts: new Date().toISOString(), msg: `Filter match: ${filterMatch}` });

  const inputCondsMatch = validateInputConditions(rule, icmPayload);
  log.push({ ts: new Date().toISOString(), msg: `Input conditions match: ${inputCondsMatch}` });

  if (!icmTypeMatch || !filterMatch || !inputCondsMatch) {
    log.push({ ts: new Date().toISOString(), msg: 'Rule would NOT fire (condition not met).' });
    return { ok: true, wouldFire: false, log };
  }

  const windowMs = rule.trigger.threshold.windowMs ?? 60000;
  const needed   = rule.trigger.threshold.count    ?? 1;
  let   ts       = (counters.get(ruleId) ?? []).filter((t) => now - t <= windowMs);
  ts.push(now);

  log.push({ ts: new Date().toISOString(), msg: `Counter after this ICM: ${ts.length}/${needed}` });
  const wouldFire = ts.length >= needed;
  log.push({ ts: new Date().toISOString(), msg: wouldFire ? 'RULE FIRES → dispatching actions…' : 'Not yet at threshold.' });

  if (wouldFire) {
    const ctx = {
      count:    ts.length,
      windowMs,
      ruleName: rule.name,
      icmType:  icmPayload.icmType ?? rule.trigger.icmType,
      lastIcm:  icmPayload,
      payload:  { ...icmPayload },
    };
    for (const action of rule.actions) {
      try {
        if (action.actionType === 'email') {
          await sendEmail(action, ctx);
          log.push({ ts: new Date().toISOString(), msg: `✉ Email sent to: ${(action.to ?? []).join(', ')}` });
        } else if (action.actionType === 'webhook') {
          await fireWebhook(action, ctx);
          log.push({ ts: new Date().toISOString(), msg: `🔗 Webhook fired: ${action.method ?? 'POST'} ${action.url}` });
        }
      } catch (e) {
        log.push({ ts: new Date().toISOString(), msg: `✗ Action error (${action.actionType}): ${e.message}` });
      }
    }
  }

  return { ok: true, wouldFire, counter: { current: ts.length, needed }, log };
}
