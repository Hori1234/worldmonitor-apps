// Notification Center Service API endpoint definitions
// Paths are relative — the urlPrefix '/api/nc' is prepended by the explorer factory.

export const NC_ENDPOINTS = [
  // ── Health ──────────────────────────────────────────────────────────────────
  {
    group: 'Health', method: 'GET', path: '/health',
    desc: 'Service status and unread notification count.',
  },

  // ── Notifications ────────────────────────────────────────────────────────────
  {
    group: 'Notifications', method: 'GET', path: '/notifications',
    desc: 'List stored notifications. Supports kind, unread, page, limit query params.',
    queryParams: [
      { name: 'kind',   placeholder: 'market|news|polymarket|map|general' },
      { name: 'unread', placeholder: 'true' },
      { name: 'page',   placeholder: '1' },
      { name: 'limit',  placeholder: '50' },
    ],
  },
  {
    group: 'Notifications', method: 'GET', path: '/notifications/unread',
    desc: 'All unread notifications (up to 200).',
  },
  {
    group: 'Notifications', method: 'POST', path: '/notifications/mark-all-read',
    desc: 'Mark all stored notifications as read.',
  },
  {
    group: 'Notifications', method: 'DELETE', path: '/notifications',
    desc: 'Clear all stored notifications.',
  },
  {
    group: 'Notifications', method: 'PATCH', path: '/notifications/:id/read',
    desc: 'Mark a specific notification as read.',
    pathParams: [{ name: 'id', default: 'notification-id' }],
  },
  {
    group: 'Notifications', method: 'DELETE', path: '/notifications/:id',
    desc: 'Delete a specific notification by ID.',
    pathParams: [{ name: 'id', default: 'notification-id' }],
  },

  // ── Typed Ingest ─────────────────────────────────────────────────────────────
  {
    group: 'Ingest', method: 'POST', path: '/ingest/market',
    desc: 'Ingest a Market notification. Emits icm:market-update.',
    body: JSON.stringify({ ticker: 'AAPL', exchange: 'NASDAQ', price: 195.5, priceChangePct: 1.2, title: 'AAPL up 1.2%' }, null, 2),
  },
  {
    group: 'Ingest', method: 'POST', path: '/ingest/news',
    desc: 'Ingest a News notification. Emits icm:news-update.',
    body: JSON.stringify({ category: 'technology', title: 'AI Chip Stocks Surge', summary: 'Semiconductor companies rally.', articles: [{ headline: 'AI rally', url: 'https://example.com', publishedAt: new Date().toISOString() }] }, null, 2),
  },
  {
    group: 'Ingest', method: 'POST', path: '/ingest/polymarket',
    desc: 'Ingest a PolyMarket notification. Emits icm:polymarket-update.',
    body: JSON.stringify({ marketId: 'pm-001', question: 'Will BTC reach 100k in 2025?', yesProbability: 0.62, noProbability: 0.38 }, null, 2),
  },
  {
    group: 'Ingest', method: 'POST', path: '/ingest/map',
    desc: 'Ingest a Map notification. Emits icm:map-event.',
    body: JSON.stringify({ eventCategory: 'political', title: 'Election Protests', latitude: 48.8566, longitude: 2.3522, region: 'France', severityLevel: 'elevated' }, null, 2),
  },
  {
    group: 'Ingest', method: 'POST', path: '/ingest/general',
    desc: 'Ingest a General notification. Emits icm:general.',
    body: JSON.stringify({ template: 'alert', title: 'System Alert', message: 'Disk usage above 90%', priority: 2, channel: 'display' }, null, 2),
  },

  // ── Profiles ─────────────────────────────────────────────────────────────────
  {
    group: 'Profiles', method: 'GET', path: '/profiles',
    desc: 'List all notification profiles.',
  },
  {
    group: 'Profiles', method: 'POST', path: '/profiles',
    desc: 'Create a new notification profile.',
    body: JSON.stringify({ name: 'My Profile', description: 'Default monitoring layout' }, null, 2),
  },
  {
    group: 'Profiles', method: 'GET', path: '/profiles/:id',
    desc: 'Get a profile by ID.',
    pathParams: [{ name: 'id', default: 'profile-id' }],
  },
  {
    group: 'Profiles', method: 'PUT', path: '/profiles/:id',
    desc: 'Rename or update description of a profile.',
    pathParams: [{ name: 'id', default: 'profile-id' }],
    body: JSON.stringify({ name: 'New Name', description: 'Updated description' }, null, 2),
  },
  {
    group: 'Profiles', method: 'DELETE', path: '/profiles/:id',
    desc: 'Delete a profile and its canvas.',
    pathParams: [{ name: 'id', default: 'profile-id' }],
  },
  {
    group: 'Profiles', method: 'GET', path: '/profiles/:id/canvas',
    desc: 'Get the canvas state for a profile.',
    pathParams: [{ name: 'id', default: 'profile-id' }],
  },
  {
    group: 'Profiles', method: 'PUT', path: '/profiles/:id/canvas',
    desc: 'Save the canvas state for a profile.',
    pathParams: [{ name: 'id', default: 'profile-id' }],
    body: JSON.stringify({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, null, 2),
  },

  // ── Edge Rules ────────────────────────────────────────────────────────────────
  {
    group: 'Edge Rules', method: 'GET', path: '/edge-rules',
    desc: 'List all edge rules.',
  },
  {
    group: 'Edge Rules', method: 'POST', path: '/edge-rules',
    desc: 'Create a new edge rule.',
    body: JSON.stringify({
      name: 'Alert on AAPL spike',
      trigger: { icmType: 'icm:market-update', filter: { field: 'ticker', operator: 'eq', value: 'AAPL' }, threshold: { count: 3, windowMs: 60000 } },
      actions: [{ actionType: 'email', to: ['user@example.com'], subject: '{{ruleName}} fired', bodyTemplate: '{{count}} market events in {{windowMs}}ms' }],
    }, null, 2),
  },
  {
    group: 'Edge Rules', method: 'GET', path: '/edge-rules/:id',
    desc: 'Get an edge rule by ID.',
    pathParams: [{ name: 'id', default: 'rule-id' }],
  },
  {
    group: 'Edge Rules', method: 'PUT', path: '/edge-rules/:id',
    desc: 'Update an edge rule.',
    pathParams: [{ name: 'id', default: 'rule-id' }],
    body: JSON.stringify({ name: 'Updated Rule', enabled: true }, null, 2),
  },
  {
    group: 'Edge Rules', method: 'DELETE', path: '/edge-rules/:id',
    desc: 'Delete an edge rule.',
    pathParams: [{ name: 'id', default: 'rule-id' }],
  },
  {
    group: 'Edge Rules', method: 'POST', path: '/edge-rules/:id/enable',
    desc: 'Enable an edge rule.',
    pathParams: [{ name: 'id', default: 'rule-id' }],
  },
  {
    group: 'Edge Rules', method: 'POST', path: '/edge-rules/:id/disable',
    desc: 'Disable an edge rule.',
    pathParams: [{ name: 'id', default: 'rule-id' }],
  },
  {
    group: 'Edge Rules', method: 'POST', path: '/edge-rules/:id/test',
    desc: 'Test-fire an edge rule against a simulated ICM payload.',
    pathParams: [{ name: 'id', default: 'rule-id' }],
    body: JSON.stringify({ icmType: 'icm:market-update', ticker: 'AAPL', price: 200 }, null, 2),
  },
];
