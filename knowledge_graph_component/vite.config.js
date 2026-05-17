import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      '/api/kg': {
        target: 'http://localhost:3738',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kg/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
