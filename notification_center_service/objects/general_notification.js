/**
 * objects/general_notification.js
 * Factory + builder for General-purpose notifications.
 * The sender picks a template which constrains required fields.
 */

const VALID_TEMPLATES = ['alert', 'digest', 'status', 'metric', 'custom'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

function validateTemplate(template, data) {
  switch (template) {
    case 'alert':
      if (!data.channel) throw new Error('General alert template requires field: channel');
      break;
    case 'metric':
      if (!Array.isArray(data.fields) || data.fields.length === 0)
        throw new Error('General metric template requires at least one field with label, value, and unit');
      break;
    // digest, status, custom — no extra required fields beyond base
  }
}

export function createGeneralNotification(data) {
  const template = VALID_TEMPLATES.includes(data.template) ? data.template : 'custom';
  validateTemplate(template, data);

  return {
    id:        crypto.randomUUID(),
    kind:      'general',
    type:      data.type      ?? 'info',
    title:     data.title     ?? '',
    body:      data.body      ?? '',
    source:    data.source    ?? 'external',
    read:      false,
    timestamp: new Date().toISOString(),
    // general-specific
    template,
    priority:  VALID_PRIORITIES.includes(data.priority) ? data.priority : 'medium',
    channel:   data.channel   ?? '',
    fields:    Array.isArray(data.fields)  ? data.fields.map((f) => ({
      label: f.label ?? '',
      value: f.value ?? '',
      unit:  f.unit  ?? '',
    })) : [],
    actions:   Array.isArray(data.actions) ? data.actions.map((a) => ({
      label:  a.label  ?? '',
      url:    a.url    ?? '',
      method: a.method ?? 'GET',
    })) : [],
    expiresAt: data.expiresAt ?? null,
    meta:      data.meta      ?? {},
  };
}

export function toICM(notification) {
  return {
    icmType:        'icm:general',
    notificationId: notification.id,
    template:       notification.template,
    priority:       notification.priority,
    channel:        notification.channel,
    timestamp:      notification.timestamp,
  };
}
