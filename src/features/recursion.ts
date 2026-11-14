/*
 * Recursion policy that expands references found inside prose and markup
 * sources while treating code and command output as opaque, bounded by a
 * configurable depth and by cycle detection along the inclusion lineage.
 */
import { Effect, Schema } from 'effect'
import { Ambient } from '../kernel/index.ts'
import { value } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const PROSE = new Set([
  '',
  'md',
  'markdown',
  'mdx',
  'mdc',
  'txt',
  'text',
  'rst',
  'adoc',
  'asciidoc',
  'org',
  'textile',
  'prompt',
])

const depth = value({
  key: 'depth',
  description: 'Deepest level of nested expansion inside prose sources',
  placeholder: '<levels>',
  codec: Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 64 })),
  fallback: 8,
})

export const feature: Feature = defineFeature({
  name: 'recursion',
  refine: (_self, base) => ({
    settings: [...base.settings, depth],
    recursion: [
      ...base.recursion,
      (_, source) =>
        Effect.gen(function* () {
          if (!PROSE.has(source.kind)) return 'abstain'
          const frame = yield* Ambient.Current
          const limit = yield* depth.read
          const cyclic = source.identity !== '' && frame.lineage.includes(source.identity)
          return frame.depth >= limit || cyclic ? 'no' : 'yes'
        }),
    ],
  }),
})
