import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/schemastery',
    'zod',
  ],
})
