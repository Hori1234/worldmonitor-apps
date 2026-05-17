/**
 * main.js — Bootstrap for the Knowledge Graph Component
 */

import { GraphRenderer } from './renderer.js';
import { GraphSelector, TypeLegend, NodePanel, updateStats, renderSearchResults } from './panels.js';
import { initExplorer } from './explorer.js';
import { initNodeTree, loadNodeTree } from './node-tree.js';
import * as api from './api.js';

// ── Top-level tab navigation ──────────────────────────────────────────────────

function initTabNav() {
  document.querySelectorAll('.kg-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      document.querySelectorAll('.kg-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.kg-page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`page-${page}`)?.classList.add('active');
    });
  });
}

// ── Graph View ────────────────────────────────────────────────────────────────

async function initGraphView() {
  const renderer = new GraphRenderer('sigma-container');
  let currentGraph = null;

  // ── Wiring: GraphSelector ────────────────────────────────────────────────────
  const selector = new GraphSelector({
    onSelect: (name) => {
      if (!name) return;
      currentGraph = name;
      loadGraph(name);
      loadNodeTree(name);     // keep node browser in sync
    },
    onRefresh: () => {
      renderer.destroy();
      updateStats(0, 0, 0, 0);
      typeLegend.render([], []);
      nodePanel.hide();
    },
  });

  // ── Cross-frame refresh (triggered by scraper dashboard after KG import) ─────
  window.addEventListener('message', async (e) => {
    if (e.data?.type !== 'kg:refresh-graphs') return;
    await selector.refresh();
    const newGraph = e.data.graph;
    if (newGraph && !selector.selected) {
      selector._select.value = newGraph;
      currentGraph = newGraph;
      loadGraph(newGraph);
      loadNodeTree(newGraph);
    } else if (newGraph && selector.selected === newGraph) {
      loadGraph(newGraph);
      loadNodeTree(newGraph);
    }
  });

  // ── Wiring: TypeLegend ───────────────────────────────────────────────────────
  const typeLegend = new TypeLegend({
    onNodeTypeToggle:  (tid, vis) => renderer.setNodeTypeVisible(tid, vis),
    onEdgeTypeToggle:  (tid, vis) => renderer.setEdgeTypeVisible(tid, vis),
    onNodeTypeIsolate: (tid)      => renderer.showOnlyNodeType(tid),
    onReset:           ()         => renderer.resetTypeFilters(),
  });

  // ── Wiring: NodePanel ────────────────────────────────────────────────────────
  const nodePanel = new NodePanel({
    onEgo: (key, depth) => renderer.activateEgo(key, depth),
    onClearEgo: () => {
      renderer.deactivateEgo();
      nodePanel.clearEgoState();
    },
    onDelete: async (key) => {
      try {
        await api.deleteNode(currentGraph, key);
        await loadGraph(currentGraph);
        nodePanel.hide();
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      }
    },
    onFocus: (key) => renderer.focusNode(key),
  });

  // ── Renderer callbacks ────────────────────────────────────────────────────────
  renderer.onLoadStart = () => {
    document.getElementById('graph-loading').hidden = false;
    document.getElementById('graph-empty').hidden  = true;
  };

  renderer.onLoadEnd = (nodes, edges, err) => {
    document.getElementById('graph-loading').hidden = true;
    const emptyEl = document.getElementById('graph-empty');
    if (err) {
      emptyEl.hidden = false;
      emptyEl.querySelector('span').textContent = `Load error: ${err}`;
    } else {
      // Graph is selected and loaded — hide overlay regardless of node count
      emptyEl.hidden = true;
    }
  };

  renderer.onStatsUpdate = (total, totalEdges, visNodes, visEdges) => {
    updateStats(total, totalEdges, visNodes, visEdges);
  };

  renderer.onTypesLoaded = (nodeTypes, edgeTypes) => {
    typeLegend.render(nodeTypes, edgeTypes);
  };

  renderer.onNodeClick = async (nodeKey, attrs) => {
    document.getElementById('node-panel').hidden = false;
    document.getElementById('node-panel-body').innerHTML = '<p class="muted">Loading connections…</p>';
    // Fetch neighbors for the detail panel
    let neighbours = [];
    try {
      neighbours = await api.getNeighbors(currentGraph, nodeKey, 'outgoing', 200);
    } catch { /* ignore */ }
    nodePanel.show(nodeKey, attrs, neighbours);
  };

  renderer.onStageClick = () => nodePanel.hide();

  // ── Load graph ────────────────────────────────────────────────────────────────
  async function loadGraph(name) {
    nodePanel.hide();
    nodePanel.clearEgoState();
    renderer.deactivateEgo();
    const layout = document.getElementById('layout-select')?.value ?? 'forceAtlas2';
    const limit  = parseInt(document.getElementById('node-limit')?.value ?? '500', 10);
    await renderer.load(name, { layout, limit });
  }

  // ── Toolbar controls ──────────────────────────────────────────────────────────

  // Select Graph button — explicit load trigger for the currently-chosen graph
  document.getElementById('btn-select-graph')?.addEventListener('click', () => {
    const name = selector.selected;
    if (!name) return;
    currentGraph = name;
    loadGraph(name);
    loadNodeTree(name);
  });

  // Apply layout
  document.getElementById('btn-apply-layout')?.addEventListener('click', () => {
    const type = document.getElementById('layout-select')?.value ?? 'forceAtlas2';
    renderer.applyLayout(type);
  });

  // Fit view
  document.getElementById('btn-fit')?.addEventListener('click', () => renderer.fit());

  // Reload graph
  document.getElementById('btn-reload')?.addEventListener('click', () => {
    if (currentGraph) loadGraph(currentGraph);
  });

  // Node limit change
  document.getElementById('node-limit')?.addEventListener('change', () => {
    if (currentGraph) loadGraph(currentGraph);
  });

  // Search
  const searchInp = document.getElementById('node-search');
  let searchDebounce;
  searchInp?.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      const hits = renderer.search(searchInp.value);
      renderSearchResults(hits, (key) => {
        renderer.focusNode(key);
        searchInp.value = '';
        renderer.clearSearch();
        document.getElementById('search-results').hidden = true;
      });
      if (!searchInp.value.trim()) {
        document.getElementById('search-results').hidden = true;
        renderer.clearSearch();
      }
    }, 250);
  });

  // Close search results on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-wrap')) {
      document.getElementById('search-results').hidden = true;
    }
  });

  // Combine modal
  document.getElementById('btn-combine')?.addEventListener('click', () => {
    document.getElementById('modal-combine').classList.add('open');
  });
  document.getElementById('modal-combine-close')?.addEventListener('click', () => {
    document.getElementById('modal-combine').classList.remove('open');
  });
  document.getElementById('modal-combine-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sourcesRaw = document.getElementById('combine-sources').value.trim();
    const target     = document.getElementById('combine-target').value.trim();
    const sources    = sourcesRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (!sources.length || !target) return;
    try {
      await api.combineGraphs(sources, target);
      document.getElementById('modal-combine').classList.remove('open');
      await selector.refresh();
      selector._select.value = target;
      loadGraph(target);
    } catch (err) {
      alert(`Combine failed: ${err.message}`);
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────────
  await selector.refresh();
  // Auto-select first open graph
  const graphs = await api.listGraphs().catch(() => []);
  const first = graphs.find(g => g.status === 'open');
  if (first) {
    selector._select.value = first.name;
    currentGraph = first.name;
    await loadGraph(first.name);
    loadNodeTree(first.name);
  } else {
    // No graph to auto-select — show the placeholder
    document.getElementById('graph-empty').hidden = false;
  }
}

// ── Breadcrumb health check ───────────────────────────────────────────────────

async function checkHealth() {
  const badge = document.getElementById('kg-health-badge');
  const text  = document.getElementById('kg-health-text');
  try {
    const h = await api.health();
    badge.className = 'kg-health-badge ok';
    text.textContent = `${h.openGraphs}/${h.totalGraphs} graphs open`;
  } catch {
    badge.className = 'kg-health-badge err';
    text.textContent = 'KG Service offline';
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

initTabNav();
initGraphView();
initNodeTree();
initExplorer();
checkHealth();
setInterval(checkHealth, 15000);
