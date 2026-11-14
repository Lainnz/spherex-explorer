import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site from https://lainnz.github.io/spherex-explorer/
  base: '/spherex-explorer/',
  server: {
    port: 5173,
    // The shared settings file lives one level up, in ../config/datasets.json.
    fs: { allow: ['..'] },
  },
  build: {
    // Two separate pages: the title page and the Stellar View.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        stellar: resolve(import.meta.dirname, 'stellar.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
