import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Knowledge Graph service — must be declared BEFORE the generic /api rule
      '/api/kg': {
        target: 'http://localhost:3738',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/kg/, ''),
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
