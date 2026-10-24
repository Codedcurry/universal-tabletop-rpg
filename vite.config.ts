import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; BASE_PATH is set by the deploy workflow.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  test: {
    include: ['shared/**/*.test.ts', 'client/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
  },
});
