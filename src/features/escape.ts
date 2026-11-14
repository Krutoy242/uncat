/*
 * Backslash escape placed before any sigil, which turns the whole token into
 * literal text minus the escape character, so authors can mention syntax
 * verbatim without triggering any expansion.
 */
import { Schema, SchemaGetter } from 'effect'
import { Fragment, Replacement } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const NAME = 'escape'

class EscapeMark extends Schema.Class<EscapeMark>('uncat/escape/EscapeMark')({}) {}

const syntaxCodec = Schema.Literal('\\').pipe(
  Schema.decodeTo(EscapeMark, {
    decode: SchemaGetter.transform(() => ({})),
    encode: SchemaGetter.transform(() => '\\' as const),
  }),
)

export const feature: Feature = defineFeature({
  name: NAME,
  syntaxCodec,
  refine: (_, base) => ({
    fragments: [
      ...base.fragments,
      new Fragment({ feature: NAME, position: 'lead', rank: 0, sigils: [], pattern: () => '\\\\', codec: syntaxCodec }),
    ],
    literal: (node) => {
      const mark = node.meta.marks[NAME]
      return mark === undefined
        ? base.literal(node)
        : new Replacement({ text: node.meta.text.slice(mark.length), collapse: false })
    },
  }),
})
