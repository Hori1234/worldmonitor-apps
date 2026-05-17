# Notification Center Component

## Overview

The Notification Center Component is a standalone Vite/Vanilla JS single-page application that serves as the visual builder and live monitor for the Notification Center Service. It follows the same dark-theme, tabbed shell design used by the Knowledge Graph Explorer and the HTML Scraper Dashboard, sharing the `styles/shared.css` design system.

The app is structured around **User Notification Profiles** — named canvases, each containing an independent graph of notification objects wired together with edge rules. A profile is analogous to a "graph" in the KG Explorer: it can be created, renamed, and deleted from the header selector, and its canvas state is persisted to the service.

---

## Feature Summary

- Header with profile selector (create / rename / delete), health badge and bell widget
- Three top-level tab pages: **Canvas Builder**, **Objects Browser**, **Edge Rule Builder**
- **Canvas Builder** — infinite drag-and-drop canvas; notification node palette in a left sidebar; connection drawing between nodes; per-node config flyout; mini-map; zoom/pan controls
- **Objects Browser** — card grid of all live notification objects grouped by kind (Market, News, PolyMarket, Map, General), with search and filter
- **Edge Rule Builder** — form-driven editor for creating, editing, and testing edge rules; rule list with enable/disable toggles
- Global bell icon + unread badge + slide-in drawer (carried over from the scraper component)
- Toast overlay for transient feedback

---

## App Shell Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
│  🔔 Notification Center  [profile selector ▾] [+ New] [Rename] [Delete]  │
│                                                         ● Online  🔔 │
├──────────────────────────────────────────────────────────────────┤
│  NAV TABS                                                        │
│  [ Canvas Builder ]  [ Objects Browser ]  [ Edge Rule Builder ]  │
├──────────────────────────────────────────────────────────────────┤
│  PAGE CONTENT (fills remaining viewport height)                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
notification_center_component/
  index.html
  vite.config.js
  package.json
  src/
    main.js                   # Bootstrap, tab nav, health polling
    api.js                    # REST + WebSocket client for the service
    canvas.js                 # Infinite canvas engine (pan, zoom, node/edge rendering)
    node-palette.js           # Left sidebar: draggable node type tiles
    node-config.js            # Flyout panel: per-node configuration form
    profile-selector.js       # Header: profile CRUD (mirrors KG GraphSelector)
    objects-browser.js        # Objects Browser page
    edge-rule-builder.js      # Edge Rule Builder page
    notifications.js          # Bell + drawer + localStorage store
    toast.js                  # Transient toast overlay
    style.css                 # Component styles (imports shared.css)
```

---

## Page 1 — Canvas Builder

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ TOOLBAR: [Zoom In] [Zoom Out] [Fit] [Snap ☐] [Grid ☐]  [Save] │
├──────────────┬──────────────────────────────────────────────────┤
│ NODE PALETTE │  INFINITE CANVAS                                  │
│              │                                                   │
│  📈 Market   │   ┌──────────────┐      ┌──────────────┐        │
│  📰 News     │   │ 📈 Market    │─────▶│ 📰 News      │        │
│  🎯 Poly     │   │  INTC        │      │  USA Hot     │        │
│  🗺  Map     │   └──────────────┘      └──────────────┘        │
│  ⚙  General │                                                   │
│              │                          ┌──────────────┐        │
│              │                          │ 🎯 PolyMarket│        │
│              │                          │  "bet x"     │        │
│              │                          └──────────────┘        │
│              │                                    │              │
│              │                          ┌─────────▼────┐        │
│              │                          │ ⚡ Edge Rule  │        │
│              │                          │  3 in 60s    │        │
│              │                          │  → email     │        │
│              │                          └──────────────┘        │
│              │                                         [mini-map]│
└──────────────┴──────────────────────────────────────────────────┘
```

### Node Palette (left sidebar)

A vertical strip of draggable tile buttons, one per notification kind plus one for Edge Rules. Tiles show an icon and label. Dragging a tile onto the canvas creates a new, unconfigured node of that kind.

| Tile | Icon | Node kind created |
|------|------|-------------------|
| Market | 📈 | `market` |
| News | 📰 | `news` |
| PolyMarket | 🎯 | `polymarket` |
| Map | 🗺 | `map` |
| General | ⚙ | `general` |
| Edge Rule | ⚡ | `edge-rule` |

### Canvas Nodes

Each dropped node renders as a card (120 × 80 px default) on the canvas with:

- **Header bar** — kind icon + kind label, colour-coded per kind (matches `NODE_PALETTE` from shared design)
- **Title line** — the configured label (e.g. `INTC`, `USA Hot Topics`, `"bet x"`) or `Unconfigured` in muted text
- **Status dot** — green (active / receiving data), amber (configured, not yet receiving), grey (unconfigured)
- **Port handles** — one output port on the right edge; one input port on the left edge (for wiring to Edge Rule nodes)
- **Context menu** (right-click or ⋮ button) — Configure, Duplicate, Delete

Clicking a node opens the **Node Config Flyout** (slides in from the right, similar to KG's NodePanel).

### Connections (Edges)

Drag from an output port handle to an input port handle to draw a directed edge. Edges are rendered as smooth bezier curves. Clicking an edge shows a small label pill allowing the user to annotate the connection (e.g. `triggers`, `feeds into`). Edges connect:

- Any notification node → Edge Rule node
- Edge Rule node → Edge Rule node (chaining)

### Node Config Flyout

Slides in from the right when a node is selected. Content adapts to the node kind.

#### Market node config

```
Label:        [___________]
Ticker:       [___________]    e.g. INTC
Exchange:     [___________]    e.g. NASDAQ
Currency:     [USD ▾]
Alert on:     [priceChangePct ▾]  [gt ▾]  [5]  %
Severity:     [warning ▾]
[ Save ]  [ Cancel ]
```

#### News node config

```
Label:        [___________]
Category:     [___________]    e.g. USA Hot Topics
Max articles: [___]
Sentiment filter: [all ▾]
Severity:     [info ▾]
[ Save ]  [ Cancel ]
```

#### PolyMarket node config

```
Label:        [___________]
Market ID:    [___________]
Question:     [___________________________________________]
Alert on:     [probability ▾]  [gt ▾]  [0.75]
Severity:     [warning ▾]
[ Save ]  [ Cancel ]
```

#### Map node config

```
Label:        [___________]
Event category: [aircraft ▾]
Country:      [___________]   ISO 3166-1 alpha-2
Entity name:  [___________]
Tags:         [___________]   comma-separated
Severity:     [info ▾]
[ Save ]  [ Cancel ]
```

#### General node config

```
Label:        [___________]
Template:     [alert ▾]
Priority:     [medium ▾]
Channel:      [___________]
Fields:       [ + Add field ]
  label [___]  value [___]  unit [___]  [ × ]
[ Save ]  [ Cancel ]
```

#### Edge Rule node config

```
Label:        [___________]
Match ICM:    [* (any) ▾]         ← populated from connected input nodes
Filter field: [___________]
Operator:     [eq ▾]
Value:        [___________]
Threshold:    [___] events in [___] ms
Reset after fire: [☑]
Action:       [email ▾]
  To:         [___________]
  Subject:    [___________]
  Body:       [ multiline textarea ]
[ Save ]  [ Cancel ]
```

### Toolbar Controls

| Control | Action |
|---------|--------|
| Zoom In / Out | Scale canvas ±10 % |
| Fit | Fit all nodes into viewport |
| Snap ☐ | Toggle snap-to-grid |
| Grid ☐ | Show/hide background dot grid |
| Save | POST canvas state to service (`PUT /profiles/:id/canvas`) |

### Canvas State (persisted per profile)

```json
{
  "profileId": "uuid",
  "nodes": [
    {
      "id": "uuid",
      "kind": "market | news | polymarket | map | general | edge-rule",
      "x": 0,
      "y": 0,
      "config": { }
    }
  ],
  "edges": [
    {
      "id": "uuid",
      "sourceNodeId": "uuid",
      "targetNodeId": "uuid",
      "label": "string"
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

---

## User Notification Profiles

Profiles are managed from the header, identical to the KG Graph Selector pattern.

- **Dropdown** lists all saved profiles; selecting one loads its canvas.
- **+ New** opens a modal to name the profile and optionally clone from an existing one.
- **Rename** — inline edit in the dropdown or modal.
- **Delete** — confirmation dialog before removal.
- Each profile starts with an empty canvas.

### Example profiles

```
Profile: "User Notification 1"
  Canvas nodes:
    📈 Market  — ticker: INTC
    📰 News    — category: USA Hot Topics
    🎯 Poly    — question: "bet x"
    ⚡ Edge Rule — threshold 3 in 60 s → email

Profile: "User Notification 2"
  Canvas nodes:
    📈 Market  — ticker: CRUDEOIL
    📰 News    — category: Iran War
    ⚡ Edge Rule — threshold 5 in 300 s → email
```

---

## Page 2 — Objects Browser

A card-grid view of all notification objects currently registered in the service, grouped by kind.

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ FILTER BAR  [All ▾]  [Search objects…]           Sort: [Latest ▾]│
├────────────────┬────────────────┬────────────────┬───────────────┤
│  📈 MARKET (4) │  📰 NEWS (7)   │  🎯 POLY (2)   │  🗺 MAP (3)  │
│                │                │                │               │
│  ┌──────────┐  │  ┌──────────┐  │  ┌──────────┐  │ ┌──────────┐ │
│  │ INTC     │  │  │ USA Hot  │  │  │ "bet x"  │  │ │ Aircraft │ │
│  │ NASDAQ   │  │  │ Topics   │  │  │ 0.72 prob│  │ │ over DE  │ │
│  │ $42.10   │  │  │ 12 art.  │  │  │ Vol $12k │  │ │ LH 400   │ │
│  │ +2.3%  ● │  │  │ neutral● │  │  │         ●│  │ │ 52°N 13°E│ │
│  └──────────┘  │  └──────────┘  │  └──────────┘  │ └──────────┘ │
└────────────────┴────────────────┴────────────────┴───────────────┘
```

Each card shows key summary fields for that kind and a live status dot. Clicking a card opens a detail modal showing the full notification object JSON plus a timeline of the last 10 received payloads for that object.

### Filter bar

- **Kind filter** — dropdown: All / Market / News / PolyMarket / Map / General
- **Search** — filters by label, ticker, category, question, country, etc.
- **Sort** — Latest first / Oldest first / Alphabetical / Status

---

## Page 3 — Edge Rule Builder

A form-driven CRUD interface for the service's edge rules, with a live test panel.

### Layout

```
┌─────────────────────────────┬──────────────────────────────────────┐
│  RULE LIST                  │  RULE EDITOR                         │
│                             │                                       │
│  ● AAPL spike alert    [✎] │  Name:    [________________________]  │
│  ● Iran news digest    [✎] │  ICM type: [icm:market-update ▾]     │
│  ○ Crude oil watch     [✎] │  Filter:  field [___]  op [eq ▾]     │
│                             │           value [___]                 │
│  [ + New Rule ]             │  Threshold: [3] events in [60000] ms │
│                             │  Reset after fire: [☑]               │
│                             │                                       │
│                             │  ── Actions ──────────────────────── │
│                             │  [ + Add action ]                    │
│                             │  ┌────────────────────────────────┐  │
│                             │  │ Type: [email ▾]                │  │
│                             │  │ To:   [analyst@example.com]    │  │
│                             │  │ Subj: [AAPL — {{count}} alerts]│  │
│                             │  │ Body: [textarea]               │  │
│                             │  └────────────────────────────────┘  │
│                             │                                       │
│                             │  ── Live Test ─────────────────────  │
│                             │  [ Simulate ICM ]  [ Clear log ]     │
│                             │  ┌────────────────────────────────┐  │
│                             │  │ 14:02:01  ICM received          │  │
│                             │  │ 14:02:03  counter: 1/3          │  │
│                             │  │ 14:02:07  counter: 2/3          │  │
│                             │  │ 14:02:09  RULE FIRED → email   │  │
│                             │  └────────────────────────────────┘  │
│                             │  [ Save Rule ]  [ Delete Rule ]       │
└─────────────────────────────┴──────────────────────────────────────┘
```

### Rule List panel

- Lists all rules fetched from `GET /edge-rules`
- Active status toggle (green dot = enabled, grey = disabled)
- Click a row to load it into the editor
- `+ New Rule` starts the editor with blank fields

### Rule Editor panel

All fields map 1-to-1 to the Edge Rule schema defined in `notification_center_service.md`. The `Match ICM` dropdown is pre-populated with all `icm:*` types.

Multiple actions can be added per rule. Each action renders as a collapsible card. Supported action types match the service schema:

| Action type | Required fields |
|-------------|-----------------|
| `email` | To (multi-value), Subject, Body template |
| `webhook` | URL, Method (`POST`/`PUT`), optional Headers (key-value pairs), Body template |

Future action types (`push`, `sms`) render as disabled placeholder cards when encountered in a loaded rule.

### Live Test panel

- `Simulate ICM` sends a synthetic ICM payload (pre-filled from the current rule's `icmType`) to the service's internal test endpoint (`POST /edge-rules/:id/test`).
- The log window tails WebSocket `edge-rule:fired` events in real time, showing timestamps, counter state, and which actions were executed.

---

## Global Header Elements

### Profile Selector (mirrors KG GraphSelector)

```html
<select id="profile-select">…</select>
<button id="btn-new-profile">+ New</button>
<button id="btn-rename-profile">Rename</button>
<button id="btn-delete-profile">Delete</button>
```

Managed by `profile-selector.js`, which calls `GET /profiles`, `POST /profiles`, `PUT /profiles/:id`, `DELETE /profiles/:id`.

### Health Badge

```html
<div id="nc-health-badge">
  <span class="health-dot"></span>
  <span id="nc-health-text">Connecting…</span>
</div>
```

Polled every 10 s via `GET /health`.

### Bell + Drawer (from notifications.js)

Identical implementation to the existing scraper component bell/drawer, wired to the notification center WebSocket instead of the scraper WebSocket.

---

## WebSocket Subscription

`api.js` opens a single `WebSocket` to the service and multiplexes all event types:

| Event received | Handler |
|----------------|---------|
| `notification:new` | Add to drawer store, bump unread badge |
| `notification:read` | Update read state in store |
| `notification:cleared` | Empty store, hide badge |
| `icm:*` (if `ICM_FORWARD_WS=true`) | Update live status dots on canvas nodes |
| `edge-rule:fired` | Append to Edge Rule Builder live test log; toast |

---

## CSS Design Conventions

Follows the existing design system (`styles/shared.css`) exactly:

| Token | Usage |
|-------|-------|
| `--bg-1` / `--bg-2` / `--bg-3` | Page / panel / card backgrounds |
| `--border` | All dividers |
| `--accent` | Active tab underline, selected node ring, save buttons |
| `--text` / `--text-2` / `--text-3` | Primary / secondary / muted text |
| `--radius` / `--radius-sm` | Cards / inputs |
| `--font` / `--mono` | UI text / code/JSON |

Node kind colours follow the `NODE_PALETTE` array (same palette as KG renderer):

| Kind | Colour |
|------|--------|
| `market` | `#6366f1` (indigo) |
| `news` | `#f59e0b` (amber) |
| `polymarket` | `#10b981` (emerald) |
| `map` | `#06b6d4` (cyan) |
| `general` | `#8b5cf6` (violet) |
| `edge-rule` | `#ef4444` (red) |

---

## HTML Skeleton (`index.html`)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Notification Center</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body>
<div id="nc-app">

  <!-- ── Header ──────────────────────────────────────────────────── -->
  <header id="nc-header">
    <div class="nch-left">
      <span class="nc-logo">🔔</span>
      <span class="nc-title">Notification Center</span>
    </div>
    <div class="nch-center">
      <select id="profile-select" class="profile-select">
        <option value="">— select a profile —</option>
      </select>
      <button id="btn-new-profile"    class="btn btn-accent btn-sm">+ New</button>
      <button id="btn-rename-profile" class="btn btn-ghost  btn-sm">Rename</button>
      <button id="btn-delete-profile" class="btn btn-danger btn-sm">Delete</button>
    </div>
    <div class="nch-right">
      <div id="nc-health-badge" class="health-badge">
        <span class="health-dot"></span>
        <span id="nc-health-text">Connecting…</span>
      </div>
      <button id="notif-bell" class="btn btn-ghost btn-icon" aria-label="Notifications">
        🔔 <span id="notif-badge" class="notif-badge" hidden></span>
      </button>
    </div>
  </header>

  <!-- ── Nav tabs ────────────────────────────────────────────────── -->
  <nav id="nc-nav">
    <button class="nc-nav-btn active" data-page="canvas">Canvas Builder</button>
    <button class="nc-nav-btn"        data-page="objects">Objects Browser</button>
    <button class="nc-nav-btn"        data-page="rules">Edge Rule Builder</button>
  </nav>

  <!-- ══ Page: Canvas Builder ══════════════════════════════════════ -->
  <div id="page-canvas" class="nc-page active">
    <div id="canvas-toolbar">
      <button id="btn-zoom-in">+</button>
      <button id="btn-zoom-out">−</button>
      <button id="btn-fit">Fit</button>
      <label class="toolbar-toggle"><input type="checkbox" id="chk-snap"> Snap</label>
      <label class="toolbar-toggle"><input type="checkbox" id="chk-grid" checked> Grid</label>
      <div class="toolbar-spacer"></div>
      <button id="btn-save-canvas" class="btn btn-accent btn-sm">Save</button>
    </div>
    <div id="canvas-body">
      <!-- Left: node palette -->
      <aside id="node-palette">
        <div class="palette-tile" draggable="true" data-kind="market">   📈 Market</div>
        <div class="palette-tile" draggable="true" data-kind="news">     📰 News</div>
        <div class="palette-tile" draggable="true" data-kind="polymarket">🎯 PolyMarket</div>
        <div class="palette-tile" draggable="true" data-kind="map">      🗺 Map</div>
        <div class="palette-tile" draggable="true" data-kind="general">  ⚙ General</div>
        <div class="palette-tile palette-tile--rule" draggable="true" data-kind="edge-rule">⚡ Edge Rule</div>
      </aside>
      <!-- Centre: infinite canvas -->
      <div id="nc-canvas-wrap">
        <canvas id="nc-canvas"></canvas>
        <div id="nc-minimap"></div>
      </div>
      <!-- Right: node config flyout (hidden until node selected) -->
      <aside id="node-config-panel" class="side-panel" hidden>
        <div class="side-panel-header">
          <span id="node-config-title">Configure node</span>
          <button id="node-config-close" class="btn btn-ghost btn-icon">✕</button>
        </div>
        <div id="node-config-body"></div>
      </aside>
    </div>
  </div>

  <!-- ══ Page: Objects Browser ═════════════════════════════════════ -->
  <div id="page-objects" class="nc-page">
    <div id="objects-toolbar">
      <select id="objects-kind-filter">
        <option value="">All</option>
        <option value="market">Market</option>
        <option value="news">News</option>
        <option value="polymarket">PolyMarket</option>
        <option value="map">Map</option>
        <option value="general">General</option>
      </select>
      <input id="objects-search" type="text" placeholder="Search objects…" />
      <select id="objects-sort">
        <option value="latest">Latest</option>
        <option value="oldest">Oldest</option>
        <option value="alpha">A–Z</option>
      </select>
    </div>
    <div id="objects-grid"></div>
    <!-- Detail modal -->
    <div id="object-detail-modal" class="modal" hidden>
      <div class="modal-backdrop"></div>
      <div class="modal-panel">
        <div class="modal-header">
          <span id="object-detail-title"></span>
          <button id="object-detail-close" class="btn btn-ghost btn-icon">✕</button>
        </div>
        <pre id="object-detail-json" class="code-block"></pre>
        <div id="object-detail-timeline"></div>
      </div>
    </div>
  </div>

  <!-- ══ Page: Edge Rule Builder ═══════════════════════════════════ -->
  <div id="page-rules" class="nc-page">
    <div id="rules-layout">
      <aside id="rules-list-panel">
        <div id="rules-list"></div>
        <button id="btn-new-rule" class="btn btn-accent btn-sm">+ New Rule</button>
      </aside>
      <div id="rule-editor-panel">
        <div id="rule-editor-form">
          <!-- fields injected by edge-rule-builder.js -->
        </div>
        <div id="rule-live-test">
          <div class="test-controls">
            <button id="btn-simulate-icm" class="btn btn-ghost btn-sm">Simulate ICM</button>
            <button id="btn-clear-log"    class="btn btn-ghost btn-sm">Clear log</button>
          </div>
          <div id="rule-test-log" class="code-block"></div>
        </div>
        <div id="rule-editor-actions">
          <button id="btn-save-rule"   class="btn btn-accent">Save Rule</button>
          <button id="btn-delete-rule" class="btn btn-danger">Delete Rule</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Notification drawer ──────────────────────────────────────── -->
  <aside id="notif-drawer" hidden>
    <div class="drawer-backdrop"></div>
    <div class="drawer-panel">
      <div class="drawer-header">
        <span>Notifications</span>
        <button id="notif-mark-read" class="btn btn-ghost btn-sm">Mark all read</button>
        <button id="notif-clear"     class="btn btn-ghost btn-sm">Clear</button>
      </div>
      <ul id="notif-list"></ul>
    </div>
  </aside>

  <!-- ── Toasts ────────────────────────────────────────────────────── -->
  <div id="toasts"></div>

</div>
<script type="module" src="/src/main.js"></script>
</body>
</html>
```

---

## Module Responsibilities

### `main.js`
- Imports all modules
- Calls `initTabNav()`, `initProfileSelector()`, `initCanvas()`, `initObjectsBrowser()`, `initEdgeRuleBuilder()`, `initNotifications(wsSubscribe)`, health polling
- Exposes `wsSubscribe` from `api.js` to `notifications.js`

### `api.js`

All methods map 1-to-1 to service endpoints:

| Method | HTTP call | Notes |
|--------|-----------|-------|
| `connectWS()` | `WS /notifications/ws` | Returns `subscribe(cb)` |
| `healthCheck()` | `GET /health` | |
| `listProfiles()` | `GET /profiles` | |
| `createProfile(name)` | `POST /profiles` | |
| `renameProfile(id, name)` | `PUT /profiles/:id` | |
| `deleteProfile(id)` | `DELETE /profiles/:id` | |
| `getCanvas(profileId)` | `GET /profiles/:id/canvas` | |
| `saveCanvas(profileId, state)` | `PUT /profiles/:id/canvas` | |
| `listNotifications(params?)` | `GET /notifications` | Accepts `kind`, `page`, `unread` query params |
| `markRead(id)` | `PATCH /notifications/:id/read` | |
| `markAllRead()` | `POST /notifications/mark-all-read` | |
| `clearAll()` | `DELETE /notifications` | |
| `listEdgeRules()` | `GET /edge-rules` | |
| `createRule(rule)` | `POST /edge-rules` | |
| `updateRule(id, rule)` | `PUT /edge-rules/:id` | |
| `deleteRule(id)` | `DELETE /edge-rules/:id` | |
| `enableRule(id)` | `POST /edge-rules/:id/enable` | |
| `disableRule(id)` | `POST /edge-rules/:id/disable` | Called by `toggleRule(id, enabled)` dispatcher |
| `testRule(id, payload)` | `POST /edge-rules/:id/test` | Returns evaluation log array |

### `canvas.js`
- `initCanvas()` — attaches pointer events, renders a dot-grid background
- `addNode(kind, x, y)` — creates a canvas node object; renders it
- `removeNode(id)`
- `addEdge(sourceId, targetId, label?)`
- `removeEdge(id)`
- `getCanvasState()` — serialises nodes + edges + viewport to JSON
- `loadCanvasState(state)` — deserialises and renders a saved state
- `clearCanvas()`
- Pan with middle-mouse or space-drag; zoom with scroll wheel
- Node drag with left-mouse; connect by dragging from port handle

### `node-palette.js`
- Renders the palette tiles
- Wires `dragstart` events; sets `dataTransfer` with `kind`
- Canvas drop zone receives `dragover` / `drop` and calls `canvas.addNode(kind, x, y)`

### `node-config.js`
- `openConfig(nodeId)` — renders the appropriate form into `#node-config-body`
- `closeConfig()`
- Each kind has its own `renderMarketForm()`, `renderNewsForm()`, etc.
- On save, calls `canvas.updateNodeConfig(nodeId, config)` and persists

### `profile-selector.js`
- Mirrors `GraphSelector` from the KG component exactly
- CRUD modal for profile name; calls `api.js` profile methods

### `objects-browser.js`
- `initObjectsBrowser()` — fetches `GET /notifications?kind=*` on tab activation
- `renderGrid(objects)` — renders kind-grouped card grid
- Search and filter are client-side on the fetched list
- Card click opens the detail modal with JSON + timeline

### `edge-rule-builder.js`
- `initEdgeRuleBuilder()` — fetches and renders rule list
- `renderRuleEditor(rule?)` — populates the form fields
- Action cards are dynamically added/removed
- `simulateICM()` — builds a synthetic payload and calls `api.testRule(id, payload)`
- Live test log subscribes to `edge-rule:fired` WS events via `wsSubscribe`

### `notifications.js`
- Identical to the scraper component implementation
- Re-wired to the notification center WS instead of the scraper WS
- `STORAGE_KEY` changed from `'scraper:notifications'` to `'nc:notifications'` to avoid collision with the scraper component when both are open

### `toast.js`
- Identical to the scraper component implementation

---

## Cross-reference with Service

All endpoints used by this component are now documented in `notification_center_service.md`. Quick reference:

| Component need | Service endpoint |
|----------------|------------------|
| Health polling | `GET /health` |
| Profile CRUD | `GET/POST /profiles`, `PUT/DELETE /profiles/:id` |
| Canvas persistence | `GET/PUT /profiles/:id/canvas` |
| Notification store | `GET /notifications`, `PATCH /notifications/:id/read`, etc. |
| Edge rule CRUD | `GET/POST /edge-rules`, `PUT/DELETE /edge-rules/:id` |
| Edge rule toggle | `POST /edge-rules/:id/enable` or `POST /edge-rules/:id/disable` |
| Live rule test | `POST /edge-rules/:id/test` |
| Typed ingest (for test simulation) | `POST /ingest/:kind` |
| Real-time events | `WS /notifications/ws` |

See `notification_center_service.md` for full schemas, ICM payloads, and Edge Rule Engine logic.
