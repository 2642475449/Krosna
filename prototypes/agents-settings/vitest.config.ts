import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: { include: ['prototypes/agents-settings/src/**/*.test.{ts,tsx}'], environment: 'node' },
});
