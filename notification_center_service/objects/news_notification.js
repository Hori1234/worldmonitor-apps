/**
 * objects/news_notification.js
 * Factory + validator for News notifications.
 */

const REQUIRED = ['category'];

export function createNewsNotification(data) {
  for (const field of REQUIRED) {
    if (!data[field]) throw new Error(`News notification missing required field: ${field}`);
  }
  const articles = Array.isArray(data.articles) ? data.articles : [];
  return {
    id:           crypto.randomUUID(),
    kind:         'news',
    type:         data.type         ?? 'info',
    title:        data.title        ?? `News update: ${data.category}`,
    body:         data.body         ?? '',
    source:       data.source       ?? 'external',
    read:         false,
    timestamp:    new Date().toISOString(),
    // news-specific
    category:     data.category,
    articles:     articles.map((a) => ({
      headline:    a.headline    ?? '',
      url:         a.url         ?? '',
      publishedAt: a.publishedAt ?? new Date().toISOString(),
      author:      a.author      ?? '',
      summary:     a.summary     ?? '',
      sentiment:   a.sentiment   ?? 'neutral',
      tags:        Array.isArray(a.tags) ? a.tags : [],
    })),
    articleCount: data.articleCount ?? articles.length,
    meta:         data.meta         ?? {},
  };
}

export function toICM(notification) {
  return {
    icmType:        'icm:news-update',
    notificationId: notification.id,
    category:       notification.category,
    articleCount:   notification.articleCount,
    timestamp:      notification.timestamp,
  };
}
