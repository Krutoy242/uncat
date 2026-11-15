/*
 * Bare file URIs found anywhere in prose, detected by a link-recognition
 * engine taught a file scheme, so references pasted from editors and terminals
 * expand without any sigil while honouring their line anchors.
 */
import { fileURLToPath } from 'node:url'
import { Context, Effect, Layer, Option, Schema, SchemaGetter } from 'effect'
import { LinkifyIt } from 'linkify-it'
import * as mr from 'multi-integer-range'
import { lineFragment } from '../program/grammar.ts'
import { Hit, Scanner, Span } from '../program/model.ts'
import { Feature, defineFeature, owns } from '../program/program.ts'

const NAME = 'uri'

const TAIL = /\/\/(?:\/|[A-Za-z]:\/)[^\s<>"'`()[\]]*[^\s<>"'`()[\].,;:!?]/y

class UriToken extends Schema.Class<UriToken>('uncat/uri/UriToken')({
  path: Schema.String.check(
    Schema.isPattern(/^\/[^\s#<>"'`()[\]]*$/, {
      arbitraryConstraint: {
        patterns: [{ source: '^/[a-z0-9_-]{1,8}(?:/[a-z0-9_-]{1,8}){0,2}\\.[a-z]{1,3}$', flags: '' }],
      },
    }),
  ),
  fragment: Schema.String.check(
    Schema.isPattern(/^(?:L\d+(?:-L?\d+)?)?$/, {
      arbitraryConstraint: { patterns: [{ source: '^(?:L[1-9][0-9]{0,2}(?:-L[1-9][0-9]{0,2})?)?$', flags: '' }] },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.check(Schema.isPattern(/^file:\/\/\/\S+$/)).pipe(
  Schema.decodeTo(UriToken, {
    decode: SchemaGetter.transform((text: string) => {
      const hash = text.indexOf('#')
      return {
        path: hash === -1 ? text.slice(7) : text.slice(7, hash),
        fragment: hash === -1 ? '' : text.slice(hash + 1),
      }
    }),
    encode: SchemaGetter.transform(
      (token: { readonly path: string; readonly fragment: string }) =>
        `file://${token.path}${token.fragment === '' ? '' : `#${token.fragment}`}`,
    ),
  }),
)

const decodeUri = Schema.decodeUnknownOption(syntaxCodec)

class LinkPort extends Context.Service<LinkPort>()('uncat/uri/LinkPort', {
  make: Effect.sync(() => {
    const linkify = new LinkifyIt().add('file:', {
      validate: (text: string, position: number) => {
        TAIL.lastIndex = position
        return TAIL.exec(text)?.[0].length ?? 0
      },
    })
    return { match: (text: string) => linkify.match(text) ?? [] }
  }),
}) {
  static readonly layer: Layer.Layer<LinkPort> = Layer.unwrap(Effect.sync(() => Layer.effect(LinkPort, LinkPort.make)))
}

const scan = (text: string): Effect.Effect<ReadonlyArray<Hit>> =>
  Effect.map(LinkPort, (port) =>
    port
      .match(text)
      .filter((match) => match.schema === 'file:')
      .flatMap((match) => {
        const token = decodeUri(match.raw)
        return Option.isSome(token)
          ? [
              new Hit({
                span: new Span({ start: match.index, end: match.lastIndex }),
                payload: token.value,
                label: match.raw,
              }),
            ]
          : []
      }),
  ).pipe(Effect.provide(LinkPort.layer))

export const feature: Feature = defineFeature({
  name: NAME,
  requires: ['file'],
  syntaxCodec,
  refine: (self, base) => ({
    layers: [...base.layers, LinkPort.layer],
    scanners: [
      ...base.scanners,
      new Scanner({
        feature: NAME,
        priority: 5,
        tentative: false,
        codec: syntaxCodec,
        description: 'Bare file URI with optional line anchor',
        samples: [new UriToken({ path: '/path/to/file.ts', fragment: 'L1-5' })],
        scan,
      }),
    ],
    extent: (node) => {
      if (!owns(NAME)(node) || !Schema.is(UriToken)(node.payload)) return base.extent(node)
      const lines = lineFragment(node.payload.fragment)
      return lines === undefined ? base.extent(node) : mr.intersect(base.extent(node), lines)
    },
    interpret: (node) =>
      owns(NAME)(node) && Schema.is(UriToken)(node.payload)
        ? Effect.map(self.open(fileURLToPath(`file://${node.payload.path}`)), (source) => [source])
        : base.interpret(node),
  }),
})
