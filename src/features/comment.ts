/*
 * Author comments that live in a prompt source but never reach its output,
 * in both a single-word form and a bracketed form that may span lines, and
 * are removed together with the whitespace they would otherwise leave behind.
 */
import { Schema, SchemaGetter } from 'effect'
import { Body, Replacement, verbatim } from '../program/model.ts'
import { Feature, defineFeature, owns } from '../program/program.ts'

const NAME = 'comment'

const PATTERN = String.raw`##(?:\[[^\]]*\]|(?!\[)\S*)`

class Word extends Schema.TaggedClass<Word>()('Word', {
  text: Schema.String.check(
    Schema.isPattern(/^(?!\[)\S*$/, {
      arbitraryConstraint: { patterns: [{ source: '^[a-z0-9_.-]{0,12}$', flags: '' }] },
    }),
  ),
}) {}

class Bracketed extends Schema.TaggedClass<Bracketed>()('Bracketed', {
  text: Schema.String.check(
    Schema.isPattern(/^[^\]]*$/, {
      arbitraryConstraint: { patterns: [{ source: '^[a-z0-9 \n_.-]{0,24}$', flags: '' }] },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.check(Schema.isPattern(new RegExp(`^(?:${PATTERN})$`))).pipe(
  Schema.decodeTo(Schema.Union([Word, Bracketed]), {
    decode: SchemaGetter.transform((text: string) =>
      text.startsWith('##[')
        ? { _tag: 'Bracketed' as const, text: text.slice(3, -1) }
        : { _tag: 'Word' as const, text: text.slice(2) },
    ),
    encode: SchemaGetter.transform((comment: { readonly _tag: 'Word' | 'Bracketed'; readonly text: string }) =>
      comment._tag === 'Bracketed' ? `##[${comment.text}]` : `##${comment.text}`,
    ),
  }),
)

export const feature: Feature = defineFeature({
  name: NAME,
  syntaxCodec,
  refine: (_, base) => ({
    bodies: [
      ...base.bodies,
      new Body({
        feature: NAME,
        sigil: '@',
        pattern: PATTERN,
        accepts: ['lead'],
        priority: 30,
        label: verbatim,
        codec: syntaxCodec,
        description: 'Comment stripped with surrounding whitespace',
        samples: [new Word({ text: 'comment' }), new Bracketed({ text: 'spaced comment' })],
      }),
    ],
    literal: (node) =>
      base.literal(node) ?? (owns(NAME)(node) ? new Replacement({ text: '', collapse: true }) : undefined),
  }),
})
