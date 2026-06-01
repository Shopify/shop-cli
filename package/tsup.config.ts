import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/bin.ts', 'src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
