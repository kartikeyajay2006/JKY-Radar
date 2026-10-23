import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    'analysis-worker': 'src/workers/analysis-worker.ts',
    'seed-demo': 'src/scripts/seed-demo.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  // Bundle workspace packages; keep third-party dependencies external.
  noExternal: [/^@jky\//],
});
