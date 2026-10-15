// SPDX-License-Identifier: MIT
// browseML's pages in one folder: ../web (the runtime, the three .wasm, the model's pin, the landing page index.html)
// is copied as it is, and the browseML app (app.html, src/clientside/) is built beside it. Threads need
// the page served cross-origin isolated (COOP same-origin, COEP credentialless), as `vite` and `vite preview` do here.
// DreamKnob (MIT, Dreamodus Software Inc.) is vendored as its built package in vendor/dreamknob.
//   npm run build  →  dist/  (index.html: the landing page · app.html: the browseML app)
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const isolated = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: resolve(__dirname, '../web'),
  plugins: [react()],
  resolve: {
    alias: { dreamknob: resolve(__dirname, 'vendor/dreamknob/dist/index.js') },
    dedupe: ['react', 'react-dom'],
  },
  server: { headers: isolated, open: '/app.html' },
  // never open a browser tab from preview: the tests and measurements serve with it headless (it inherited server.open
  // and opened app.html in the visitor's own browser on every run)
  preview: { headers: isolated, open: false },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: { app: resolve(__dirname, 'app.html') } },
  },
});
