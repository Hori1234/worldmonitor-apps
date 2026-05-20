import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5175,
    proxy: {
      // KG service — must be declared BEFORE the generic /api rule
      '/api/kg': {
        target: 'http://localhost:3738',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kg/, ''),
      },
      // Notification Center service
      '/api/nc': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nc/, ''),
      },
      // Graphify Knowledge Graphs service — before the generic /api rule
      '/api/graphify': {
        target: 'http://localhost:3740',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/graphify/, ''),
        // Without this handler, Vite's SPA fallback serves index.html for
        // failed GET requests (connection refused), which looks like the
        // explorer returning HTML instead of JSON.
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Graphify KG service unavailable (localhost:3740)' }));
          });
        },
      },
      // Scraper service
      '/api': {
        target: 'http://localhost:3737',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
