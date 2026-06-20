import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vite Configuration for Lazuli Web Frontend
 *
 * Migrated from Next.js to Vite for:
 * - Faster development builds with HMR
 * - Simpler SPA architecture
 * - Better Bun integration
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3001,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  css: {
    postcss: './postcss.config.mjs',
  },
});
