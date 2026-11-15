/*
 * Direct modifier for at-sign tokens that includes a payload exactly as
 * stored, vetoing recursive expansion of its contents while leaving wrapping,
 * slicing and deduplication untouched.
 */
import { Effect, Schema, SchemaGetter } from 'effect'
import { Fragment } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const NAME = 'direct'

class DirectMark extends Schema.Class<DirectMark>('uncat/direct/DirectMark')({}) {}

const syntaxCodec = Schema.Literal('=').pipe(
  Schema.decodeTo(DirectMark, {
    decode: SchemaGetter.transform(() => ({})),
    encode: SchemaGetter.transform(() => '=' as const),
  }),
)

export const feature: Feature = defineFeature({
  name: NAME,
  syntaxCodec,
  refine: (_, base) => ({
    fragments: [
      ...base.fragments,
      new Fragment({
        feature: NAME,
        position: 'prefix',
        rank: 1,
        sigils: ['@'],
        pattern: () => '=',
        codec: syntaxCodec,
        description: 'Direct inclusion without recursive expansion',
        samples: () => [new DirectMark({})],
      }),
    ],
    recursion: [...base.recursion, (node) => Effect.succeed(node.meta.marks[NAME] === undefined ? 'abstain' : 'no')],
  }),
})
