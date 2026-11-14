/*
 * Type-level stand-in for the compile-time feature module, giving the checker
 * a typed empty tuple while the bundler, test runner and development loader
 * each substitute the real discovery output under the same specifier.
 */
import { Feature } from './program.ts'

export const discoveredFeatures: ReadonlyArray<Feature> = []
