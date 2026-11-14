/*
 * System clipboard as an expandable source, reading it through the platform's
 * own paste utility via the shared subprocess capability, so copied snippets
 * can be referenced like any other document and expanded recursively.
 */
import { platform } from 'node:process'
import { Effect, Schema, SchemaGetter } from 'effect'
import { Ambient } from '../kernel/index.ts'
import { Body, Fault, Source, identityOf } from '../program/model.ts'
import { Feature, defineFeature, owns, whole } from '../program/program.ts'

const NAME = 'clipboard'

const PATTERN = ':clipboard'

class ClipboardToken extends Schema.Class<ClipboardToken>('uncat/clipboard/ClipboardToken')({}) {}

const syntaxCodec = Schema.Literal(PATTERN).pipe(
  Schema.decodeTo(ClipboardToken, {
    decode: SchemaGetter.transform(() => ({})),
    encode: SchemaGetter.transform(() => PATTERN),
  }),
)

const paste = (): string =>
  platform === 'darwin'
    ? 'pbpaste'
    : platform === 'win32'
      ? 'powershell -NoProfile -Command Get-Clipboard'
      : process.env['WAYLAND_DISPLAY'] === undefined
        ? 'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output'
        : 'wl-paste --no-newline'

export const feature: Feature = defineFeature({
  name: NAME,
  requires: ['shell'],
  syntaxCodec,
  refine: (self, base) => ({
    bodies: [
      ...base.bodies,
      new Body({
        feature: NAME,
        sigil: '@',
        pattern: PATTERN,
        accepts: ['lead', 'prefix'],
        priority: 40,
        label: () => '`clipboard`',
        codec: syntaxCodec,
      }),
    ],
    interpret: (node) =>
      owns(NAME)(node) && Schema.is(ClipboardToken)(node.payload)
        ? Effect.gen(function* () {
            const frame = yield* Ambient.Current
            const result = yield* self.spawn(paste())
            if (result.exitCode !== 0) {
              return yield* new Fault({
                code: 'clipboard',
                message: 'cannot read the clipboard',
                subject: NAME,
                hint: result.stderr || 'install a paste utility',
              })
            }
            return [
              new Source({
                tag: 'clipboard',
                attrs: [['from', 'system']],
                identity: identityOf('clipboard', ''),
                label: NAME,
                scope: frame.scope,
                kind: 'txt',
                text: result.stdout,
                extent: whole,
              }),
            ]
          })
        : base.interpret(node),
  }),
})
