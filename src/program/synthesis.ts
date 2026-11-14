/*
 * The program equation itself: folds every discovered feature over the
 * neutral base exactly once, so all entry points share one synthesized
 * program without ever naming the features that compose it.
 */
import { discoveredFeatures } from 'virtual:ahead-features'
import { Ahead } from '../kernel/index.ts'
import { Feature, Program, base } from './program.ts'

const synthesized = Ahead.synthesize(base, discoveredFeatures)

export const features: ReadonlyArray<Feature> = synthesized.features

export const program: Program = new Program({
  ...synthesized.kernel,
  traits: Object.fromEntries(features.map((feature) => [feature.name, feature.concurrency])),
})
