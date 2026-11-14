/*
 * Test runner configuration that installs the same feature-discovery plugin as
 * the bundler, so law tests fold exactly the features that would ship.
 */
import { defineConfig } from 'vitest/config'
import { aheadFeatures } from './build/discovery.ts'

const config: ReturnType<typeof defineConfig> = defineConfig({
  plugins: [aheadFeatures(import.meta.dirname)],
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
  },
})

export default config
