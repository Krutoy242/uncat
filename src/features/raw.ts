/*
 * Raw modifier that repeats a token's sigil to request direct interpolation,
 * vetoing the wrapping envelope so the payload text is spliced straight into
 * the surrounding line for any token family that carries a sigil.
 */
import { Schema, SchemaGetter } from 'effect'
import { escapeRegex } from '../program/grammar.ts'
import { Fragment } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const NAME = 'raw'

class RawMark extends Schema.Class<RawMark>('uncat/raw/RawMark')({
  sigil: Schema.String.check(
    Schema.isPattern(/^[^\p{L}\p{N}\s]$/u, {
      arbitraryConstraint: { patterns: [{ source: '^[!-/:-@]$', flags: '' }] },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.pipe(
  Schema.decodeTo(RawMark, {
    decode: SchemaGetter.transform((sigil: string) => ({ sigil })),
    encode: SchemaGetter.transform((mark: { readonly sigil: string }) => mark.sigil),
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
        rank: 0,
        sigils: [],
        pattern: escapeRegex,
        codec: syntaxCodec,
      }),
    ],
    enveloping: [...base.enveloping, (node) => (node.meta.marks[NAME] === undefined ? 'abstain' : 'no')],
  }),
})
