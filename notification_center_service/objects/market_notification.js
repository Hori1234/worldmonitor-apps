/**
 * objects/market_notification.js
 * Factory + validator for Market Data notifications.
 */

const REQUIRED = ['ticker'];

export function createMarketNotification(data) {
  for (const field of REQUIRED) {
    if (!data[field]) throw new Error(`Market notification missing required field: ${field}`);
  }
  return {
    id:             crypto.randomUUID(),
    kind:           'market',
    type:           data.type           ?? 'info',
    title:          data.title          ?? `Market update: ${data.ticker}`,
    body:           data.body           ?? '',
    source:         data.source         ?? 'external',
    read:           false,
    timestamp:      new Date().toISOString(),
    // market-specific
    ticker:         data.ticker,
    exchange:       data.exchange        ?? '',
    price:          data.price           ?? null,
    priceChange:    data.priceChange     ?? null,
    priceChangePct: data.priceChangePct  ?? null,
    volume:         data.volume          ?? null,
    marketCap:      data.marketCap       ?? null,
    high24h:        data.high24h         ?? null,
    low24h:         data.low24h          ?? null,
    currency:       data.currency        ?? 'USD',
    alertThreshold: data.alertThreshold  ?? null,
    meta:           data.meta            ?? {},
  };
}

export function toICM(notification) {
  return {
    icmType:        'icm:market-update',
    notificationId: notification.id,
    ticker:         notification.ticker,
    exchange:       notification.exchange,
    price:          notification.price,
    priceChangePct: notification.priceChangePct,
    timestamp:      notification.timestamp,
  };
}
