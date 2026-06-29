import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  // Ejecutable: npx @opwebrtc/signaling-server
  banner: { js: '#!/usr/bin/env node' },
  external: ['ws'],
});
