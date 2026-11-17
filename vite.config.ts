import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    // Local single-player desktop browser game. Bind to loopback only so the
    // dev server is never reachable from another machine.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
