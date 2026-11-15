/*
 * Markdown-link references whose target is a relative path or a file URI with
 * an optional line anchor, so links written for humans double as inclusions
 * and leave a readable link behind wherever their payload is hoisted.
 */
import { fileURLToPath } from 'node:url'
import { Effect, Schema, SchemaGetter } from 'effect'
import * as mr from 'multi-integer-range'
import { lineFragment } from '../program/grammar.ts'
import { Body, verbatim } from '../program/model.ts'
import { Feature, defineFeature, owns } from '../program/program.ts'

const NAME = 'link'

const PATTERN = String.raw`\[[^\]\n]*\]\((?:[^()\s]|\([^()\s]*\))+\)`

class LinkToken extends Schema.Class<LinkToken>('uncat/link/LinkToken')({
  label: Schema.String.check(
    Schema.isPattern(/^[^\]\n]*$/, {
      arbitraryConstraint: { patterns: [{ source: '^[a-z0-9 _-]{0,12}$', flags: '' }] },
    }),
  ),
  target: Schema.String.check(
    Schema.isPattern(/^(?:[^()\s]|\([^()\s]*\))+$/, {
      arbitraryConstraint: {
        patterns: [
          {
            source: '^(?:file:///)?[a-z0-9_-]{1,8}(?:/[a-z0-9_-]{1,8}){0,2}\\.[a-z]{1,3}(?:#L[1-9][0-9]{0,2})?$',
            flags: '',
          },
        ],
      },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.check(Schema.isPattern(new RegExp(`^(?:${PATTERN})$`))).pipe(
  Schema.decodeTo(LinkToken, {
    decode: SchemaGetter.transform((text: string) => {
      const middle = text.indexOf('](')
      return { label: text.slice(1, middle), target: text.slice(middle + 2, -1) }
    }),
    encode: SchemaGetter.transform(
      (token: { readonly label: string; readonly target: string }) => `[${token.label}](${token.target})`,
    ),
  }),
)

const split = (target: string): { readonly path: string; readonly fragment: string } => {
  const hash = target.indexOf('#')
  const path = hash === -1 ? target : target.slice(0, hash)
  return {
    path: path.startsWith('file:') ? fileURLToPath(path) : decodeURIComponent(path),
    fragment: hash === -1 ? '' : target.slice(hash + 1),
  }
}

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
        accepts: ['lead', 'prefix'],
        priority: 25,
        label: verbatim,
        codec: syntaxCodec,
        description: 'Markdown link to a path or file URI',
        samples: [
          new LinkToken({ label: 'doc', target: 'path.ts' }),
          new LinkToken({ label: 'doc', target: 'file:///path#L1-5' }),
        ],
      }),
    ],
    extent: (node, total) => {
      if (!owns(NAME)(node) || !Schema.is(LinkToken)(node.payload)) return base.extent(node, total)
      const lines = lineFragment(split(node.payload.target).fragment)
      return lines === undefined ? base.extent(node, total) : mr.intersect(base.extent(node, total), lines)
    },
    interpret: (node) =>
      owns(NAME)(node) && Schema.is(LinkToken)(node.payload)
        ? Effect.map(self.open(split(node.payload.target).path), (source) => [source])
        : base.interpret(node),
  }),
})
