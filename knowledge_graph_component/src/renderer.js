/**
 * renderer.js
 *
 * Core graph rendering module — manages the graphology MultiDirectedGraph
 * and sigma.js renderer. Responsible for:
 *   - Loading nodes + edges from the KG API
 *   - Sigma initialization with node/edge reducers for visual state
 *   - Layout management (ForceAtlas2 live, FA2 static, Circular, Random)
 *   - Node type / edge type visibility filtering
 *   - Ego-network mode (highlight subgraph around selected node)
 *   - Node search + camera focus
 */

import { MultiDirectedGraph } from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import circular from 'graphology-layout/circular';
import random from 'graphology-layout/random';
import * as api from './api.js';

// ── Color palettes ────────────────────────────────────────────────────────────

const NODE_PALETTE = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
  '#a78bfa', '#fbbf24', '#34d399', '#f87171', '#60a5fa',
  '#e879f9', '#fb923c', '#a3e635', '#38bdf8', '#4ade80',
];

const EDGE_PALETTE = [
  '#64748b', '#94a3b8', '#6366f1', '#f59e0b', '#10b981',
  '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#ef4444',
];

const SELECTED_COLOR    = '#ffd700';
const HIGHLIGHTED_COLOR = '#60a5fa';
const DIMMED_COLOR      = '#3a4d63';

// ── GraphRenderer ─────────────────────────────────────────────────────────────

export class GraphRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);

    /** @type {MultiDirectedGraph|null} */
    this.graph = null;

    /** @type {Sigma|null} */
    this.renderer = null;

    /** @type {FA2Layout|null} */
    this.fa2Worker = null;

    this.currentGraph = null;   // currently loaded graph name
    this.selectedNode = null;   // node key of selected node
    this.egoMode = false;
    this.egoSet = new Set();    // node keys in current ego network

    // Type registries
    this._nodeTypeColors = new Map();
    this._edgeTypeColors = new Map();
    this.allNodeTypes = new Set();
    this.allEdgeTypes = new Set();
    this.hiddenNodeTypes = new Set();
    this.hiddenEdgeTypes = new Set();

    // Search highlight
    this.searchMatches = new Set();

    // Callbacks (set by consumers)
    this.onNodeClick    = null;  // (nodeKey, attrs) => void
    this.onStageClick   = null;  // () => void
    this.onStatsUpdate  = null;  // (total, edges, visNodes, visEdges) => void
    this.onTypesLoaded  = null;  // (nodeTypes[], edgeTypes[]) => void
    this.onLoadStart    = null;  // () => void
    this.onLoadEnd      = null;  // (nodeCount, edgeCount, err?) => void
  }

  // ── Type colors ──────────────────────────────────────────────────────────────

  nodeColor(typeId) {
    if (!this._nodeTypeColors.has(typeId)) {
      this._nodeTypeColors.set(typeId, NODE_PALETTE[this._nodeTypeColors.size % NODE_PALETTE.length]);
    }
    return this._nodeTypeColors.get(typeId);
  }

  edgeColor(typeId) {
    if (!this._edgeTypeColors.has(typeId)) {
      this._edgeTypeColors.set(typeId, EDGE_PALETTE[this._edgeTypeColors.size % EDGE_PALETTE.length]);
    }
    return this._edgeTypeColors.get(typeId);
  }

  // ── Load graph ───────────────────────────────────────────────────────────────

  async load(graphName, options = {}) {
    const { limit = 500, layout = 'forceAtlas2' } = options;

    this.currentGraph = graphName;
    this.selectedNode = null;
    this.egoMode = false;
    this.egoSet.clear();
    this.searchMatches.clear();
    this._nodeTypeColors.clear();
    this._edgeTypeColors.clear();
    this.allNodeTypes.clear();
    this.allEdgeTypes.clear();
    this.hiddenNodeTypes.clear();
    this.hiddenEdgeTypes.clear();

    this.onLoadStart?.();
    this._destroyRenderer();

    this.graph = new MultiDirectedGraph();

    try {
      // 1 ── Load nodes (paginated up to limit)
      let loaded = 0;
      let after;
      const PAGE = Math.min(limit, 500);

      while (loaded < limit) {
        const batch = await api.queryNodes(graphName, {
          allow_full_scan: true,
          limit: Math.min(PAGE, limit - loaded),
          ...(after !== undefined ? { after } : {}),
        });
        if (!batch || batch.length === 0) break;

        for (const node of batch) {
          const typeId = Number(node.typeId);
          this.allNodeTypes.add(typeId);
          const key = String(node.id);
          this.graph.addNode(key, {
            label:   this._nodeLabel(node),
            size:    16,
            color:   this.nodeColor(typeId),
            type:    'circle',
            x:       (Math.random() - 0.5) * 200,
            y:       (Math.random() - 0.5) * 200,
            // stored metadata (prefixed _ to avoid sigma confusion)
            _id:     key,
            _typeId: typeId,
            _key:    node.key,
            _props:  node.props ?? {},
          });
        }

        after = batch[batch.length - 1].id;
        loaded += batch.length;
        if (batch.length < PAGE) break;
      }

      if (this.graph.order === 0) {
        this._initRenderer();
        this.onLoadEnd?.(0, 0);
        return;
      }

      // 2 ── Load edges in parallel batches of 30 node lookups
      const nodeKeys = this.graph.nodes();
      const BATCH = 30;
      for (let i = 0; i < nodeKeys.length; i += BATCH) {
        const slice = nodeKeys.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          slice.map(k => api.getNeighbors(graphName, k, 'outgoing', 200))
        );
        results.forEach((r, j) => {
          if (r.status !== 'fulfilled' || !r.value) return;
          const fromKey = slice[j];
          for (const nb of r.value) {
            const toKey = String(nb.nodeId);
            if (!this.graph.hasNode(toKey)) continue;
            const eTypeId = Number(nb.edgeTypeId ?? nb.edgeType ?? 0);
            this.allEdgeTypes.add(eTypeId);
            const edgeKey = `${fromKey}__${eTypeId}__${toKey}`;
            if (!this.graph.hasEdge(edgeKey)) {
              try {
                this.graph.addEdgeWithKey(edgeKey, fromKey, toKey, {
                  label:    `T${eTypeId}`,
                  size:     2,
                  color:    this.edgeColor(eTypeId),
                  _typeId:  eTypeId,
                  _weight:  nb.weight ?? 1,
                });
              } catch { /* duplicate key in MultiDirectedGraph – ignore */ }
            }
          }
        });
      }

      // 3 ── Apply initial layout
      this._applyStaticLayout(layout);

      // 4 ── Initialise sigma
      this._initRenderer();

      this.onTypesLoaded?.([...this.allNodeTypes], [...this.allEdgeTypes]);
      this.onLoadEnd?.(this.graph.order, this.graph.size);
      this._emitStats();

    } catch (err) {
      console.error('[renderer] load error:', err);
      this.onLoadEnd?.(0, 0, err.message);
    }
  }

  _nodeLabel(node) {
    const p = node.props ?? {};
    return p.name ?? p.title ?? p.label ?? p.id ?? node.key ?? String(node.id);
  }

  // ── Layouts ──────────────────────────────────────────────────────────────────

  _applyStaticLayout(type) {
    if (!this.graph || this.graph.order === 0) return;
    if (type === 'circular') {
      circular.assign(this.graph);
    } else if (type === 'random') {
      random.assign(this.graph, { scale: 100 });
    } else {
      // forceAtlas2 — brief synchronous run for initial positions
      random.assign(this.graph, { scale: 100 });
      try {
        forceAtlas2.assign(this.graph, {
          iterations: 80,
          settings: forceAtlas2.inferSettings(this.graph),
        });
      } catch (e) {
        console.warn('[renderer] FA2 static error:', e.message);
      }
    }
  }

  applyLayout(type) {
    if (!this.graph) return;
    this._stopFA2Worker();

    if (type === 'forceAtlas2-live') {
      const settings = forceAtlas2.inferSettings(this.graph);
      this.fa2Worker = new FA2Layout(this.graph, { settings });
      this.fa2Worker.start();
      this._fa2Timer = setTimeout(() => this._stopFA2Worker(), 12000);
    } else {
      this._applyStaticLayout(type);
      this.renderer?.refresh();
    }
  }

  _stopFA2Worker() {
    clearTimeout(this._fa2Timer);
    if (this.fa2Worker) {
      try { this.fa2Worker.stop(); } catch { /* ignore */ }
      this.fa2Worker = null;
    }
  }

  fit() {
    this.renderer?.getCamera().animatedReset({ duration: 400 });
  }

  // ── Sigma initialisation ─────────────────────────────────────────────────────

  _initRenderer() {
    if (!this.container || !this.graph) return;

    // Reducer state captured per-refresh cycle
    const self = this;

    this.renderer = new Sigma(this.graph, this.container, {
      defaultNodeType:         'circle',
      renderEdgeLabels:        false,
      labelFont:               'Inter, system-ui, sans-serif',
      labelSize:               13,
      labelWeight:             '500',
      labelColor:              { color: '#e6edf3' },
      labelRenderedSizeThreshold: 4,
      minCameraRatio:          0.04,
      maxCameraRatio:          30,
      allowInvalidContainer:   true,

      nodeReducer(node, data) {
        const res = { ...data };
        const isSelected  = node === self.selectedNode;
        const inSearch    = self.searchMatches.size > 0;
        const isMatch     = self.searchMatches.has(node);
        const inEgo       = self.egoMode;
        const isEgoNode   = self.egoSet.has(node);

        if (isSelected) {
          res.color       = SELECTED_COLOR;
          res.size        = data.size * 2;
          res.zIndex      = 2;
          res.label       = data.label;
        } else if (inEgo && !isEgoNode) {
          res.color       = '#263348';
          res.label       = '';
          res.size        = data.size * 0.5;
        } else if (inSearch && !isMatch) {
          res.color       = DIMMED_COLOR;
          res.label       = '';
          res.size        = data.size * 0.6;
        } else if (inSearch && isMatch) {
          res.color       = HIGHLIGHTED_COLOR;
          res.size        = data.size * 1.4;
          res.zIndex      = 1;
        }
        return res;
      },

      edgeReducer(edge, data) {
        const res = { ...data };
        const src = self.graph.source(edge);
        const tgt = self.graph.target(edge);
        const inEgo = self.egoMode;

        if (inEgo && (!self.egoSet.has(src) || !self.egoSet.has(tgt))) {
          res.hidden = true;
        }
        if (self.searchMatches.size > 0) {
          const srcMatch = self.searchMatches.has(src);
          const tgtMatch = self.searchMatches.has(tgt);
          if (!srcMatch && !tgtMatch) res.color = '#263348';
        }
        return res;
      },
    });

    // ── Events ──────────────────────────────────────────────────────────────────

    this.renderer.on('clickNode', ({ node }) => {
      this.selectedNode = node;
      this.renderer.refresh();
      const attrs = this.graph.getNodeAttributes(node);
      this.onNodeClick?.(node, attrs);
    });

    this.renderer.on('clickStage', () => {
      if (this.selectedNode) {
        this.selectedNode = null;
        this.renderer.refresh();
        this.onStageClick?.();
      }
    });

    this.renderer.on('enterNode', () => {
      this.container.style.cursor = 'pointer';
    });
    this.renderer.on('leaveNode', () => {
      this.container.style.cursor = 'default';
    });
  }

  _destroyRenderer() {
    this._stopFA2Worker();
    if (this.renderer) {
      try { this.renderer.kill(); } catch { /* ignore */ }
      this.renderer = null;
    }
  }

  // ── Node/edge type visibility ─────────────────────────────────────────────────

  setNodeTypeVisible(typeId, visible) {
    if (visible) this.hiddenNodeTypes.delete(typeId);
    else this.hiddenNodeTypes.add(typeId);
    this._syncHiddenAttrs();
  }

  setEdgeTypeVisible(typeId, visible) {
    if (visible) this.hiddenEdgeTypes.delete(typeId);
    else this.hiddenEdgeTypes.add(typeId);
    this._syncHiddenAttrs();
  }

  showOnlyNodeType(typeId) {
    this.hiddenNodeTypes = new Set([...this.allNodeTypes].filter(t => t !== typeId));
    this._syncHiddenAttrs();
  }

  resetTypeFilters() {
    this.hiddenNodeTypes.clear();
    this.hiddenEdgeTypes.clear();
    this._syncHiddenAttrs();
  }

  _syncHiddenAttrs() {
    if (!this.graph) return;
    this.graph.forEachNode((node, attrs) => {
      const hide = this.hiddenNodeTypes.has(attrs._typeId);
      if (attrs.hidden !== hide) this.graph.setNodeAttribute(node, 'hidden', hide);
    });
    this.graph.forEachEdge((edge, attrs, source, target) => {
      const srcHide = this.graph.getNodeAttribute(source, 'hidden');
      const tgtHide = this.graph.getNodeAttribute(target, 'hidden');
      const typeHide = this.hiddenEdgeTypes.has(attrs._typeId);
      const hide = srcHide || tgtHide || typeHide;
      if (attrs.hidden !== hide) this.graph.setEdgeAttribute(edge, 'hidden', hide);
    });
    this.renderer?.refresh();
    this._emitStats();
  }

  // ── Ego-network ───────────────────────────────────────────────────────────────

  async activateEgo(nodeKey, depth = 2) {
    if (!this.currentGraph) return;
    try {
      const result = await api.subgraph(this.currentGraph, {
        startNodeId: nodeKey,
        maxDepth: depth,
      });
      this.egoSet.clear();
      this.egoSet.add(String(nodeKey));

      // subgraph returns { nodes: [...], edges: [...] }
      const nodeList = result?.nodes ?? result?.nodeIds ?? result ?? [];
      for (const n of nodeList) {
        const id = n?.id ?? n?.nodeId ?? n;
        if (id !== undefined) this.egoSet.add(String(id));
      }

      this.egoMode = true;
      this.renderer?.refresh();
      this._emitStats();
    } catch (err) {
      console.error('[renderer] ego network error:', err);
    }
  }

  deactivateEgo() {
    this.egoMode = false;
    this.egoSet.clear();
    this.renderer?.refresh();
    this._emitStats();
  }

  // ── Search ───────────────────────────────────────────────────────────────────

  search(query) {
    this.searchMatches.clear();
    if (!this.graph || !query?.trim()) {
      this.renderer?.refresh();
      return [];
    }
    const q = query.toLowerCase();
    const hits = [];
    this.graph.forEachNode((node, attrs) => {
      const label = String(attrs.label ?? '').toLowerCase();
      const key   = String(attrs._key ?? '').toLowerCase();
      const propsStr = JSON.stringify(attrs._props ?? {}).toLowerCase();
      if (label.includes(q) || key.includes(q) || propsStr.includes(q)) {
        this.searchMatches.add(node);
        hits.push({ node, attrs });
      }
    });
    this.renderer?.refresh();
    return hits;
  }

  clearSearch() {
    this.searchMatches.clear();
    this.renderer?.refresh();
  }

  focusNode(nodeKey) {
    if (!this.renderer || !this.graph?.hasNode(nodeKey)) return;
    const { x, y } = this.graph.getNodeAttributes(nodeKey);
    this.renderer.getCamera().animate({ x, y, ratio: 0.25 }, { duration: 500 });
    this.selectedNode = nodeKey;
    this.renderer.refresh();
    this.onNodeClick?.(nodeKey, this.graph.getNodeAttributes(nodeKey));
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  _emitStats() {
    if (!this.graph || !this.onStatsUpdate) return;
    let vn = 0, ve = 0;
    this.graph.forEachNode((_, a) => { if (!a.hidden) vn++; });
    this.graph.forEachEdge((_, a) => { if (!a.hidden) ve++; });
    this.onStatsUpdate(this.graph.order, this.graph.size, vn, ve);
  }

  getNodeAttrs(nodeKey) {
    return this.graph?.getNodeAttributes(nodeKey) ?? null;
  }

  destroy() {
    this._stopFA2Worker();
    this._destroyRenderer();
    this.graph = null;
  }
}
