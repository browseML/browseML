// SPDX-License-Identifier: MIT
// browseML's pages in one folder: ../web (the runtime, the three .wasm, the model's pin, the landing page index.html)
// is copied as it is, and ultimate-clientside (clientside.html, src/clientside/) is built beside it. Threads need
// the page served cross-origin isolated (COOP same-origin, COEP credentialless), as `vite` and `vite preview` do here.
// DreamKnob (MIT, Dreamodus Software Inc.) is vendored as its built package in vendor/dreamknob.
//   npm run build  →  dist/  (index.html: the landing page · clientside.html: ultimate-clientside)
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
  server: { headers: isolated, open: '/clientside.html' },
  preview: { headers: isolated },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input: { clientside: resolve(__dirname, 'clientside.html') } },
  },
});
