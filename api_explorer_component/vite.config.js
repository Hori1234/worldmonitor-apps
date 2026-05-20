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
