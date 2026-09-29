import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages sub-paths and from any static host.
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 5000,
    assetsInlineLimit: 0,
  },
});
