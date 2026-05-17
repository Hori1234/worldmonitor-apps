# Notification Center Service

## Overview

The Notification Center Service is a back-end service responsible for aggregating, storing, and distributing notifications across all WorldMonitor components. It acts as a central hub that receives typed event payloads from external systems (market data feeds, news aggregators, prediction markets, geo-event streams, etc.) and internal services (HTML Scraper, Knowledge Graph), converts them into strongly-typed notification objects, emits internal communication messages (ICMs), and delivers real-time updates to connected clients via WebSocket or REST.

An **Edge Rule Engine** sits on top of the notification pipeline and lets you wire ICMs together: when a configurable threshold of a given message type is reached within a time window, a downstream action (e.g. send an email digest) is automatically triggered.

---

## Responsibilities

- Receive typed event payloads from external and internal sources
- Instantiate strongly-typed notification objects (Market, News, PolyMarket, Map, General)
- Emit an **Internal Communication Message (ICM)** for every accepted notification
- Persist notifications with type, severity, timestamp, and metadata
- Push real-time notifications to connected clients over WebSocket
- Provide a REST API for querying, marking read, and clearing notifications
- Evaluate **Edge Rules** against the ICM stream and fire downstream actions (email, webhook, etc.)
- Apply retention policies (max stored, TTL, per-category limits)

---

## Planned API Endpoints

### Core notification endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notifications` | List all notifications (paginated, filterable by `kind`) |
| `GET` | `/notifications/unread` | List unread notifications |
| `POST` | `/notifications` | Create a general-purpose notification |
| `PATCH` | `/notifications/:id/read` | Mark a single notification as read |
| `POST` | `/notifications/mark-all-read` | Mark all notifications as read |
| `DELETE` | `/notifications` | Clear all notifications |
| `DELETE` | `/notifications/:id` | Delete a single notification |
| `GET` | `/notifications/ws` | WebSocket upgrade endpoint for real-time delivery |

### Typed ingest endpoints (external systems)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ingest/market` | Ingest a Market Data notification |
| `POST` | `/ingest/news` | Ingest a News notification |
| `POST` | `/ingest/polymarket` | Ingest a PolyMarket Data notification |
| `POST` | `/ingest/map` | Ingest a Map Data notification |
| `POST` | `/ingest/general` | Ingest a General-purpose notification |

### Profile endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health check — returns `{ status: "ok", uptime }` |
| `GET` | `/profiles` | List all user notification profiles |
| `POST` | `/profiles` | Create a new profile |
| `PUT` | `/profiles/:id` | Rename a profile |
| `DELETE` | `/profiles/:id` | Delete a profile and its canvas |
| `GET` | `/profiles/:id/canvas` | Get the saved canvas state for a profile |
| `PUT` | `/profiles/:id/canvas` | Save (upsert) the canvas state for a profile |

### Edge Rule endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/edge-rules` | List all configured edge rules |
| `POST` | `/edge-rules` | Create a new edge rule |
| `GET` | `/edge-rules/:id` | Get a single edge rule |
| `PUT` | `/edge-rules/:id` | Update an edge rule |
| `DELETE` | `/edge-rules/:id` | Delete an edge rule |
| `POST` | `/edge-rules/:id/enable` | Enable a rule |
| `POST` | `/edge-rules/:id/disable` | Disable a rule |
| `POST` | `/edge-rules/:id/test` | Simulate an ICM payload against a rule; returns evaluation log |

---

## Profile Schema

A **Profile** is a named canvas owned by a user. It is the top-level container that groups notification nodes and the edges between them.

```json
{
  "id":          "uuid-v4",
  "name":        "string",
  "description": "string",
  "createdAt":   "ISO 8601",
  "updatedAt":   "ISO 8601",
  "canvas": {
    "profileId": "uuid",
    "nodes": [
      {
        "id":     "uuid",
        "kind":   "market | news | polymarket | map | general | edge-rule",
        "x":      0,
        "y":      0,
        "config": {}
      }
    ],
    "edges": [
      {
        "id":           "uuid",
        "sourceNodeId": "uuid",
        "targetNodeId": "uuid",
        "label":        "string"
      }
    ],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  }
}
```

Canvas node `config` objects mirror the ingest payload fields for each `kind` (minus `id`, `read`, `timestamp`). Edge-rule nodes store the full Edge Rule schema inline.

---

## Base Notification Schema

All notification objects share a common base, extended by each typed variant.

```json
{
  "id":        "uuid-v4",
  "kind":      "market | news | polymarket | map | general",
  "type":      "success | error | warning | info",
  "title":     "string",
  "body":      "string",
  "source":    "string",
  "meta":      {},
  "read":      false,
  "timestamp": "ISO 8601"
}
```

---

## Typed Notification Objects

### 1. Market Data Notification

Emitted when an external system reports an update for a tracked stock or financial instrument. Triggers ICM `icm:market-update`.

**Ingest endpoint:** `POST /ingest/market`

```json
{
  "kind": "market",
  "type": "info | warning | error",
  "title": "string",
  "body":  "string",
  "source": "string",
  "ticker": "string",
  "exchange": "string",
  "price": 0.00,
  "priceChange": 0.00,
  "priceChangePct": 0.00,
  "volume": 0,
  "marketCap": 0,
  "high24h": 0.00,
  "low24h": 0.00,
  "currency": "USD",
  "alertThreshold": {
    "field": "price | priceChangePct | volume",
    "operator": "gt | lt | gte | lte | eq",
    "value": 0
  },
  "meta": {}
}
```

**ICM emitted:** `icm:market-update`

```json
{
  "icmType": "icm:market-update",
  "notificationId": "uuid",
  "ticker": "string",
  "exchange": "string",
  "price": 0.00,
  "priceChangePct": 0.00,
  "timestamp": "ISO 8601"
}
```

---

### 2. News Notification

Emitted when an external news aggregator or scraper delivers updated articles for a category. Triggers ICM `icm:news-update`.

**Ingest endpoint:** `POST /ingest/news`

```json
{
  "kind": "news",
  "type": "info | warning",
  "title": "string",
  "body":  "string",
  "source": "string",
  "category": "string",
  "articles": [
    {
      "headline": "string",
      "url": "string",
      "publishedAt": "ISO 8601",
      "author": "string",
      "summary": "string",
      "sentiment": "positive | neutral | negative",
      "tags": ["string"]
    }
  ],
  "articleCount": 0,
  "meta": {}
}
```

**ICM emitted:** `icm:news-update`

```json
{
  "icmType": "icm:news-update",
  "notificationId": "uuid",
  "category": "string",
  "articleCount": 0,
  "timestamp": "ISO 8601"
}
```

---

### 3. PolyMarket Data Notification

Emitted when an external system reports an update for a tracked prediction market contract on PolyMarket. Triggers ICM `icm:polymarket-update`.

**Ingest endpoint:** `POST /ingest/polymarket`

```json
{
  "kind": "polymarket",
  "type": "info | warning | error",
  "title": "string",
  "body":  "string",
  "source": "string",
  "marketId": "string",
  "question": "string",
  "outcome": "string",
  "probability": 0.00,
  "probabilityChange": 0.00,
  "volume": 0.00,
  "liquidity": 0.00,
  "closingDate": "ISO 8601",
  "resolved": false,
  "resolvedOutcome": "string | null",
  "alertThreshold": {
    "field": "probability | probabilityChange | volume",
    "operator": "gt | lt | gte | lte | eq",
    "value": 0
  },
  "meta": {}
}
```

**ICM emitted:** `icm:polymarket-update`

```json
{
  "icmType": "icm:polymarket-update",
  "notificationId": "uuid",
  "marketId": "string",
  "question": "string",
  "probability": 0.00,
  "probabilityChange": 0.00,
  "timestamp": "ISO 8601"
}
```

---

### 4. Map Data Notification

Emitted when a geo-event occurs: an aircraft entering a country's airspace, a vessel entering territorial waters, or a news event geolocated to a country or region. Triggers ICM `icm:map-event`.

**Ingest endpoint:** `POST /ingest/map`

```json
{
  "kind": "map",
  "type": "info | warning | error",
  "title": "string",
  "body":  "string",
  "source": "string",
  "eventCategory": "aircraft | vessel | news | weather | other",
  "subCategory": "string",
  "coordinates": {
    "lat": 0.0,
    "lng": 0.0,
    "altitude": 0,
    "heading": 0,
    "speed": 0
  },
  "boundingBox": {
    "northEast": { "lat": 0.0, "lng": 0.0 },
    "southWest": { "lat": 0.0, "lng": 0.0 }
  },
  "country": "string",
  "countryCode": "ISO 3166-1 alpha-2",
  "region": "string",
  "entityId": "string",
  "entityName": "string",
  "entityType": "aircraft | vessel | person | organisation | other",
  "tags": ["string"],
  "meta": {}
}
```

**ICM emitted:** `icm:map-event`

```json
{
  "icmType": "icm:map-event",
  "notificationId": "uuid",
  "eventCategory": "string",
  "country": "string",
  "countryCode": "string",
  "entityName": "string",
  "coordinates": { "lat": 0.0, "lng": 0.0 },
  "timestamp": "ISO 8601"
}
```

---

### 5. General-Purpose Notification

A flexible notification object with a builder pattern that lets the sender define its own shape. The sender selects a `template` which constrains which fields are required. Triggers ICM `icm:general`.

**Ingest endpoint:** `POST /ingest/general`

```json
{
  "kind": "general",
  "type": "success | error | warning | info",
  "title": "string",
  "body":  "string",
  "source": "string",
  "template": "alert | digest | status | metric | custom",
  "priority": "low | medium | high | critical",
  "channel": "string",
  "fields": [
    {
      "label": "string",
      "value": "string | number | boolean",
      "unit":  "string"
    }
  ],
  "actions": [
    {
      "label": "string",
      "url":   "string",
      "method": "GET | POST"
    }
  ],
  "expiresAt": "ISO 8601 | null",
  "meta": {}
}
```

**Builder templates**

| Template | Required extra fields | Description |
|----------|-----------------------|-------------|
| `alert` | `priority`, `channel` | Urgency-driven alert with a mandatory channel target |
| `digest` | `fields[]` | A structured summary of multiple data points |
| `status` | `fields[].label`, `fields[].value` | System/service status update |
| `metric` | `fields[].label`, `fields[].value`, `fields[].unit` | Single KPI or metric report |
| `custom` | *(none)* | Fully free-form; only base fields are validated |

**ICM emitted:** `icm:general`

```json
{
  "icmType": "icm:general",
  "notificationId": "uuid",
  "template": "string",
  "priority": "string",
  "channel": "string",
  "timestamp": "ISO 8601"
}
```

---

## Internal Communication Messages (ICM)

Every accepted ingest call produces exactly one ICM. ICMs are lightweight, in-process events emitted via an internal EventEmitter (or message bus). They decouple the ingest pipeline from downstream consumers such as the Edge Rule Engine, WebSocket broadcaster, and email dispatcher.

### ICM Types

| ICM type | Source notification kind |
|----------|--------------------------|
| `icm:market-update` | `market` |
| `icm:news-update` | `news` |
| `icm:polymarket-update` | `polymarket` |
| `icm:map-event` | `map` |
| `icm:general` | `general` |
| `icm:scraper-job` | internal scraper events |
| `icm:kg-import` | internal knowledge-graph events |

### Internal ICM Payloads

**`icm:scraper-job`** — emitted when the HTML Scraper Service completes, errors or cancels a job:

```json
{
  "icmType":        "icm:scraper-job",
  "notificationId": "uuid",
  "jobId":          "string",
  "event":          "completed | item-error | cancelled",
  "completed":      0,
  "failed":         0,
  "errorUrl":       "string | null",
  "errorMessage":   "string | null",
  "timestamp":      "ISO 8601"
}
```

**`icm:kg-import`** — emitted when the Knowledge Graph Service finishes an import or update:

```json
{
  "icmType":        "icm:kg-import",
  "notificationId": "uuid",
  "graphName":      "string",
  "event":          "import-complete | import-error | graph-deleted",
  "nodesAdded":     0,
  "edgesAdded":     0,
  "errorMessage":   "string | null",
  "timestamp":      "ISO 8601"
}
```

---

## Edge Rule Engine

The Edge Rule Engine subscribes to the ICM stream and evaluates rules on every incoming message. A rule fires when a **trigger condition** is satisfied, which then executes one or more **actions** (currently: send email).

### Rule Schema

```json
{
  "id": "uuid-v4",
  "name": "string",
  "enabled": true,
  "description": "string",
  "trigger": {
    "icmType": "icm:market-update | icm:news-update | icm:polymarket-update | icm:map-event | icm:general | *",
    "filter": {
      "field": "string",
      "operator": "eq | neq | gt | lt | gte | lte | contains | regex",
      "value": "any"
    },
    "threshold": {
      "count": 5,
      "windowMs": 60000,
      "resetAfterFire": true
    }
  },
  "actions": [
    {
      "actionType": "email",
      "to":           ["string"],
      "subject":      "string",
      "bodyTemplate": "string"
    },
    {
      "actionType": "webhook",
      "url":          "string",
      "method":       "POST | PUT",
      "headers":      { "Authorization": "Bearer …" },
      "bodyTemplate": "string"
    }
  ],
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

> **Note:** `push` (browser Web Push) and `sms` (Twilio) are reserved future action types. The `actionType` field is intentionally a string so new types can be added without a schema migration.

```json
```

### Trigger Logic

1. An ICM arrives at the Edge Rule Engine.
2. For each enabled rule whose `trigger.icmType` matches (or is `*`):
   - If a `filter` is defined, evaluate `icm[field] <operator> value`. Skip if false.
   - Increment the rule's internal rolling counter within the `windowMs` window.
   - If `counter >= threshold.count`, fire all `actions`.
   - If `resetAfterFire` is `true`, reset the counter to `0` after firing.
3. Counters older than `windowMs` are automatically expired.

### Example Rule — email when 3 market alerts fire in 60 seconds

```json
{
  "name": "AAPL spike alert",
  "enabled": true,
  "trigger": {
    "icmType": "icm:market-update",
    "filter": {
      "field": "ticker",
      "operator": "eq",
      "value": "AAPL"
    },
    "threshold": {
      "count": 3,
      "windowMs": 60000,
      "resetAfterFire": true
    }
  },
  "actions": [
    {
      "actionType": "email",
      "to": ["analyst@example.com"],
      "subject": "AAPL — 3 market alerts in 60s",
      "bodyTemplate": "{{count}} AAPL market updates fired between {{windowStart}} and {{windowEnd}}."
    }
  ]
}
```

### Body Template Variables

| Variable | Value |
|----------|-------|
| `{{count}}` | Number of ICMs that triggered the rule |
| `{{windowStart}}` | ISO timestamp of the oldest ICM in the window |
| `{{windowEnd}}` | ISO timestamp of the newest ICM in the window |
| `{{icmType}}` | The ICM type that fired |
| `{{ruleName}}` | The rule name |
| `{{lastIcm.*}}` | Any field from the last ICM payload, e.g. `{{lastIcm.ticker}}` |

---

## WebSocket Events

Events are emitted as JSON objects over the WebSocket connection.

| Event type | Direction | Description |
|------------|-----------|-------------|
| `notification:new` | Server → Client | A new notification has been created |
| `notification:read` | Server → Client | One or more notifications marked read |
| `notification:cleared` | Server → Client | All notifications cleared |
| `icm:*` | Server → Client | Raw ICM forwarded to subscribed clients (opt-in) |
| `edge-rule:fired` | Server → Client | An edge rule fired and actions were executed |

---

## Integration Points

- **HTML Scraper Service** — emits `job:completed`, `job:item-error`, `job:cancelled` → converted to `icm:scraper-job`.
- **Knowledge Graph Service** — emits import/update events → converted to `icm:kg-import`.
- **External market data feeds** — POST to `/ingest/market`.
- **News aggregators / HTML Scraper** — POST to `/ingest/news`.
- **PolyMarket adapters** — POST to `/ingest/polymarket`.
- **ADS-B / vessel tracking / geo-event feeds** — POST to `/ingest/map`.
- **Any custom system** — POST to `/ingest/general` with chosen builder template.

---

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `PORT` | `3003` | HTTP/WS server port |
| `MAX_STORED` | `500` | Maximum number of stored notifications |
| `RETENTION_DAYS` | `7` | Auto-delete notifications older than N days |
| `EDGE_RULES_PERSIST` | `true` | Persist edge rules to disk between restarts |
| `PROFILES_PERSIST` | `true` | Persist profiles and canvas states between restarts |
| `PROFILES_DATA_DIR` | `./data/profiles` | Directory for profile + canvas JSON files |
| `EMAIL_SMTP_HOST` | — | SMTP host for email actions |
| `EMAIL_SMTP_PORT` | `587` | SMTP port |
| `EMAIL_SMTP_USER` | — | SMTP username |
| `EMAIL_SMTP_PASS` | — | SMTP password (store in env, never in code) |
| `EMAIL_FROM` | — | Sender address for edge-rule emails |
| `WEBHOOK_TIMEOUT_MS` | `5000` | Request timeout for webhook actions |
| `ICM_FORWARD_WS` | `false` | Whether to forward raw ICMs to WS clients |

---

## File Structure (planned)

```
notification_center_service/
  notification_center_index.js            # Entry point, HTTP + WS server
  notification_center_routes.js           # REST route handlers (core + ingest + edge rules)
  notification_center_manager.js          # Notification store and business logic
  notification_center_ws.js               # WebSocket broadcast layer
  notification_center_icm.js              # Internal Communication Message bus (EventEmitter)
  notification_center_edge_engine.js      # Edge Rule Engine (counter windows, action dispatch)
  notification_center_email.js            # Email action executor (SMTP/nodemailer)
  notification_center_webhook.js          # Webhook action executor (fetch/axios)
  notification_center_profiles.js         # Profile + canvas CRUD and persistence
  notification_center_settings.js         # Config / env loader
  objects/
    market_notification.js                # Market Data notification factory + validator
    news_notification.js                  # News notification factory + validator
    polymarket_notification.js            # PolyMarket notification factory + validator
    map_notification.js                   # Map Data notification factory + validator
    general_notification.js               # General-purpose notification factory + builder
  data/
    profiles/                             # One JSON file per profile (canvas + metadata)
    edge-rules/                           # One JSON file per persisted edge rule
  package.json
```
