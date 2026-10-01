import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages sub-paths and from any static host.
  base: './',
  server: { host: '127.0.0.1', port: 5173 },
  // Only the game's page: the dev-only harness pages under tools/ must not be scanned for dependencies.
  optimizeDeps: { entries: ['index.html'] },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 5000,
    assetsInlineLimit: 0,
  },
});
