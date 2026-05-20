/**
 * objects/polymarket_notification.js
 * Factory + validator for PolyMarket Data notifications.
 */

const REQUIRED = ['marketId', 'question'];

export function createPolymarketNotification(data) {
  for (const field of REQUIRED) {
    if (!data[field]) throw new Error(`PolyMarket notification missing required field: ${field}`);
  }
  return {
    id:                crypto.randomUUID(),
    kind:              'polymarket',
    type:              data.type              ?? 'info',
    title:             data.title             ?? `PolyMarket update: ${data.question}`,
    body:              data.body              ?? '',
    source:            data.source            ?? 'external',
    read:              false,
    timestamp:         new Date().toISOString(),
    // polymarket-specific
    marketId:          data.marketId,
    question:          data.question,
    outcome:           data.outcome           ?? '',
    probability:       data.probability       ?? null,
    probabilityChange: data.probabilityChange ?? null,
    volume:            data.volume            ?? null,
    liquidity:         data.liquidity         ?? null,
    closingDate:       data.closingDate        ?? null,
    resolved:          data.resolved          ?? false,
    resolvedOutcome:   data.resolvedOutcome    ?? null,
    alertThreshold:    data.alertThreshold     ?? null,
    meta:              data.meta              ?? {},
  };
}

export function toICM(notification) {
  return {
    icmType:           'icm:polymarket-update',
    notificationId:    notification.id,
    marketId:          notification.marketId,
    question:          notification.question,
    probability:       notification.probability,
    probabilityChange: notification.probabilityChange,
    timestamp:         notification.timestamp,
  };
}
