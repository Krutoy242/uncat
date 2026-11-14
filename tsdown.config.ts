/*
 * Bundler configuration that inlines every dependency into a zero-dependency
 * artifact, emits isolated declarations with the fast generator, and resolves
 * the feature folder at compile time so unused code can be shaken away.
 */
import { defineConfig } from 'tsdown'
import { aheadFeatures } from './build/discovery.ts'

const config: ReturnType<typeof defineConfig> = defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node26',
  dts: { entry: ['src/index.ts'] },
  treeshake: { moduleSideEffects: false },
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  outputOptions: { comments: { legal: true, annotation: true, jsdoc: false } },
  plugins: [aheadFeatures(import.meta.dirname)],
})

export default config
