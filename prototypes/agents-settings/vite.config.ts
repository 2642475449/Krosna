import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root,
  plugins: [react(), {
    name: 'prototype-agent-assets',
    closeBundle() {
      const source = path.resolve(root, '../../public/agents');
      const destination = path.join(root, 'dist/agents');
      mkdirSync(destination, { recursive: true });
      for (const asset of readdirSync(source)) {
        if (asset.endsWith('.svg')) copyFileSync(path.join(source, asset), path.join(destination, asset));
      }
    },
  }],
  publicDir: '../../public',
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 1435, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, copyPublicDir: false },
});
