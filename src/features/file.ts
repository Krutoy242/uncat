/*
 * Recognizes plain path references and owns reading files from disk, turning
 * a located path into a loaded source so that every other path-shaped syntax
 * can reuse a single reader instead of touching the filesystem itself.
 */
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context, Effect, Layer, Schema, SchemaGetter } from 'effect'
import { Ambient } from '../kernel/index.ts'
import { Body, Fault, Source, identityOf, quoted } from '../program/model.ts'
import { Feature, defineFeature, owns, whole } from '../program/program.ts'

const NAME = 'file'

const PATH = String.raw`(?:[A-Za-z]:(?=[\\/]))?(?:[\p{L}\p{N}_~+%@-]|\.(?=[\p{L}\p{N}_~+%@./-])|/(?=[\p{L}\p{N}_~+%@.-]))+`

class FileToken extends Schema.Class<FileToken>('uncat/file/FileToken')({
  path: Schema.String.check(
    Schema.isPattern(new RegExp(`^${PATH}$`, 'u'), {
      arbitraryConstraint: {
        patterns: [
          {
            source: '^\\.?[a-z0-9_-]{1,8}(?:/\\.?[a-z0-9_-]{1,8}){0,2}\\.[a-z]{1,3}$',
            flags: '',
          },
        ],
      },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.pipe(
  Schema.decodeTo(FileToken, {
    decode: SchemaGetter.transform((path: string) => ({ path })),
    encode: SchemaGetter.transform((token: { readonly path: string }) => token.path),
  }),
)

const failure = (code: string, path: string, message: string, hint: string): Fault =>
  new Fault({ code, message, subject: path, hint })

class FilePort extends Context.Service<FilePort>()('uncat/file/FilePort', {
  make: Effect.sync(() => ({
    exists: (path: string): Effect.Effect<boolean> =>
      Effect.promise(() =>
        stat(path).then(
          () => true,
          () => false,
        ),
      ),
    read: (path: string): Effect.Effect<string, Fault> =>
      Effect.tryPromise({
        try: () => readFile(path, 'utf8'),
        catch: (cause) =>
          String(cause).includes('EISDIR')
            ? failure('is-directory', path, `${path} is a directory`, 'add a trailing slash to include its tree')
            : failure('unreadable', path, `cannot read ${path}`, String(cause)),
      }),
  })),
}) {
  static readonly layer: Layer.Layer<FilePort> = Layer.unwrap(Effect.sync(() => Layer.effect(FilePort, FilePort.make)))
}

const expandHome = (path: string): string =>
  path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path

const display = (root: string, path: string): string => {
  const shown = relative(root, path)
  return (shown === '' ? '.' : shown).split(sep).join('/')
}

export const feature: Feature = defineFeature({
  name: NAME,
  syntaxCodec,
  refine: (self, base) => ({
    layers: [...base.layers, FilePort.layer],
    bodies: [
      ...base.bodies,
      new Body({
        feature: NAME,
        sigil: '@',
        pattern: PATH,
        accepts: ['lead', 'prefix', 'suffix'],
        priority: 10,
        label: quoted,
        codec: syntaxCodec,
      }),
    ],
    locate: (path) =>
      Effect.gen(function* () {
        const frame = yield* Ambient.Current
        const port = yield* FilePort
        const target = expandHome(path)
        const candidate = isAbsolute(target) ? target : resolve(frame.root, target)
        return (yield* port.exists(candidate)) ? candidate : yield* base.locate(path)
      }).pipe(Effect.provide(FilePort.layer)),
    open: (path) =>
      Effect.gen(function* () {
        const frame = yield* Ambient.Current
        const port = yield* FilePort
        const located = yield* self.locate(path)
        if (located === undefined) return yield* failure('not-found', path, `cannot find ${path}`, '')
        const text = yield* port.read(located)
        if (text.includes('\u0000'))
          return yield* failure('binary', path, `${path} looks binary`, 'only text files can be expanded')
        return new Source({
          tag: 'file',
          attrs: [['path', display(frame.root, located)]],
          identity: identityOf('file', located),
          label: path,
          scope: dirname(located),
          kind: extname(located).slice(1).toLowerCase(),
          text: text.replace(/\r\n?/g, '\n'),
          extent: whole,
        })
      }).pipe(Effect.provide(FilePort.layer)),
    interpret: (node) =>
      owns(NAME)(node) && Schema.is(FileToken)(node.payload)
        ? Effect.map(self.open(node.payload.path), (source) => [source])
        : base.interpret(node),
  }),
})
