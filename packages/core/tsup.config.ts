import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/blur.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  // MediaPipe es pesado y opcional: no lo empaquetamos, queda como peer.
  external: ['@mediapipe/tasks-vision'],
});
