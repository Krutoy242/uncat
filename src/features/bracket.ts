/*
 * Bracketed path syntax for file names containing spaces or punctuation that
 * the plain path grammar would split, delegating the actual read to the shared
 * file opener so both syntaxes produce identical sources.
 */
import { Effect, Schema, SchemaGetter } from 'effect'
import { Body } from '../program/model.ts'
import { Feature, defineFeature, owns } from '../program/program.ts'

const NAME = 'bracket'

const PATTERN = String.raw`\[[^\]\[\n]+\](?!\()`

class BracketToken extends Schema.Class<BracketToken>('uncat/bracket/BracketToken')({
  path: Schema.String.check(
    Schema.isPattern(/^[^\][\n]+$/, {
      arbitraryConstraint: {
        patterns: [{ source: '^[a-z0-9_-]{1,6}(?: [a-z0-9_-]{1,6}){0,2}\\.[a-z]{1,3}$', flags: '' }],
      },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.check(Schema.isPattern(new RegExp(`^(?:${PATTERN})$`))).pipe(
  Schema.decodeTo(BracketToken, {
    decode: SchemaGetter.transform((text: string) => ({ path: text.slice(1, -1) })),
    encode: SchemaGetter.transform((token: { readonly path: string }) => `[${token.path}]`),
  }),
)

export const feature: Feature = defineFeature({
  name: NAME,
  requires: ['file'],
  syntaxCodec,
  refine: (self, base) => ({
    bodies: [
      ...base.bodies,
      new Body({
        feature: NAME,
        sigil: '@',
        pattern: PATTERN,
        accepts: ['lead', 'prefix', 'suffix'],
        priority: 20,
        label: (body, suffix) => `\`${body.slice(1, -1)}${suffix}\``,
        codec: syntaxCodec,
        description: 'Path with spaces or special characters',
        samples: [new BracketToken({ path: 'file with spaces.txt' })],
      }),
    ],
    interpret: (node) =>
      owns(NAME)(node) && Schema.is(BracketToken)(node.payload)
        ? Effect.map(self.open(node.payload.path), (source) => [source])
        : base.interpret(node),
  }),
})
