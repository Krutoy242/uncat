/*
 * Opt-in aggressive mode that treats sigil-free path mentions, bare or wrapped
 * in inline code, as tentative inclusions that silently stay plain text unless
 * they resolve to a real file, which lets ordinary prose double as a manifest.
 */
import { Effect, Schema, SchemaGetter } from 'effect'
import { Hit, Scanner, Span, flag } from '../program/model.ts'
import { Feature, defineFeature, owns } from '../program/program.ts'

const NAME = 'aggressive'

const SEGMENT = String.raw`\.?[\p{L}\p{N}_@+-][\p{L}\p{N}_.@+-]*`

const BARE = String.raw`(?:\.{1,2}[\\/]|~[\\/]|/)?${SEGMENT}(?:[\\/]${SEGMENT})*\.[\p{L}\p{N}]{1,10}`

const TICK = '`'

const SCAN = new RegExp(
  String.raw`(?<![\p{L}\p{N}_@!\\/.~:-])(?:${TICK}(?<quoted>${BARE})${TICK}|(?<bare>${BARE}))(?![\p{L}\p{N}_/\\])`,
  'gu',
)

class BareToken extends Schema.Class<BareToken>('uncat/aggressive/BareToken')({
  path: Schema.String.check(
    Schema.isPattern(new RegExp(`^${BARE}$`, 'u'), {
      arbitraryConstraint: {
        patterns: [{ source: '^\\.?[a-z0-9_-]{1,8}(?:/\\.?[a-z0-9_-]{1,8}){0,2}\\.[a-z]{1,3}$', flags: '' }],
      },
    }),
  ),
  quoted: Schema.Boolean,
}) {}

const syntaxCodec = Schema.String.pipe(
  Schema.decodeTo(BareToken, {
    decode: SchemaGetter.transform((text: string) =>
      text.startsWith('`') ? { path: text.slice(1, -1), quoted: true } : { path: text, quoted: false },
    ),
    encode: SchemaGetter.transform((token: { readonly path: string; readonly quoted: boolean }) =>
      token.quoted ? `\`${token.path}\`` : token.path,
    ),
  }),
)

const enabled = flag({ key: 'aggressive', alias: 'a', description: 'Also expand sigil-free paths that exist on disk' })

const scan = (text: string): Effect.Effect<ReadonlyArray<Hit>> =>
  Effect.map(enabled.read, (on) =>
    on
      ? [...text.matchAll(SCAN)].map((match) => {
          const quoted = match.groups?.['quoted']
          const path = quoted ?? match.groups?.['bare'] ?? ''
          return new Hit({
            span: new Span({ start: match.index, end: match.index + match[0].length }),
            payload: new BareToken({ path, quoted: quoted !== undefined }),
            label: `\`${path}\``,
          })
        })
      : [],
  )

export const feature: Feature = defineFeature({
  name: NAME,
  requires: ['file'],
  syntaxCodec,
  refine: (self, base) => ({
    settings: [...base.settings, enabled],
    scanners: [...base.scanners, new Scanner({ feature: NAME, priority: 0, tentative: true, scan })],
    interpret: (node) =>
      owns(NAME)(node) && Schema.is(BareToken)(node.payload)
        ? Effect.map(self.open(node.payload.path.replaceAll('\\', '/')), (source) => [source])
        : base.interpret(node),
  }),
})
