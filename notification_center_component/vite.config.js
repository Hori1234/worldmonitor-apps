import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5176,
    proxy: {
      '/api/nc': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nc/, ''),
      },
    },
  },
});
