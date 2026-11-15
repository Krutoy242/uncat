/*
 * Glob tokens that fan out into one source per matching file, honouring
 * ignore rules unless the pattern is anchored explicitly, and lending the same
 * filesystem walk to every feature that needs to enumerate files.
 */
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Context, Effect, Layer, Schema, SchemaGetter } from 'effect'
import ignore from 'ignore'
import { glob } from 'tinyglobby'
import { Ambient } from '../kernel/index.ts'
import { Body, Fault, quoted } from '../program/model.ts'
import { Feature, defineFeature, owns } from '../program/program.ts'

const NAME = 'glob'

const CHAR = String.raw`[\p{L}\p{N}_~+%@*?\[\]-]`

const ATOM = String.raw`(?:${CHAR}|\{[^{}\s]*\}|\.(?=[\p{L}\p{N}_~+%@*?\[{./-])|/(?=[\p{L}\p{N}_~+%@*?\[{.-]))`

const PATTERN = String.raw`(?!\[)(?=(?:[A-Za-z]:(?=[\\/]))?${ATOM}*?[*?{\[])(?:[A-Za-z]:(?=[\\/]))?${ATOM}+`

const LIMIT = 5_000

class GlobToken extends Schema.Class<GlobToken>('uncat/glob/GlobToken')({
  pattern: Schema.String.check(
    Schema.isPattern(new RegExp(`^${PATTERN}$`, 'u'), {
      arbitraryConstraint: {
        patterns: [{ source: '^\\.?[a-z0-9_-]{1,8}/(?:\\*\\*/)?\\*\\.[a-z]{1,3}$', flags: '' }],
      },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.pipe(
  Schema.decodeTo(GlobToken, {
    decode: SchemaGetter.transform((pattern: string) => ({ pattern })),
    encode: SchemaGetter.transform((token: { readonly pattern: string }) => token.pattern),
  }),
)

const rules = async (
  from: string,
  root: string,
  files: ReadonlyArray<string>,
): Promise<ReadonlyArray<readonly [string, string]>> => {
  const directories = new Set<string>()
  for (let current = resolve(from); ; current = dirname(current)) {
    directories.add(current)
    if (current === root || dirname(current) === current || !current.startsWith(root)) break
  }
  for (const file of files) {
    for (let current = dirname(resolve(file)); !directories.has(current); current = dirname(current)) {
      directories.add(current)
      if (dirname(current) === current || !current.startsWith(root)) break
    }
  }
  const found = await Promise.all(
    [...directories].map((directory) =>
      readFile(join(directory, '.gitignore'), 'utf8').then(
        (text) => [directory, text] as const,
        () => undefined,
      ),
    ),
  )
  return found.filter((entry) => entry !== undefined)
}

class GlobPort extends Context.Service<GlobPort>()('uncat/glob/GlobPort', {
  make: Effect.sync(() => ({
    walk: (pattern: string, cwd: string, root: string, respect: boolean): Effect.Effect<ReadonlyArray<string>, Fault> =>
      Effect.tryPromise({
        try: async () => {
          const files = await glob(pattern, {
            cwd,
            absolute: true,
            dot: true,
            ignore: respect ? ['**/.git/**', '**/node_modules/**'] : [],
          })
          if (!respect) return files.toSorted()
          const filters = (await rules(cwd, root, files)).map(
            ([directory, text]) => [directory, ignore().add(text)] as const,
          )
          return files
            .filter((file) =>
              filters.every(([directory, matcher]) => {
                const path = relative(directory, file).split(sep).join('/')
                return path.startsWith('..') || !matcher.ignores(path)
              }),
            )
            .toSorted()
        },
        catch: (cause) =>
          new Fault({ code: 'glob', message: `cannot walk ${pattern}`, subject: pattern, hint: String(cause) }),
      }),
  })),
}) {
  static readonly layer: Layer.Layer<GlobPort> = Layer.unwrap(Effect.sync(() => Layer.effect(GlobPort, GlobPort.make)))
}

const anchored = (pattern: string): boolean =>
  pattern.startsWith('./') || isAbsolute(pattern) || /^[A-Za-z]:[\\/]/.test(pattern)

export const feature: Feature = defineFeature({
  name: NAME,
  requires: ['file'],
  syntaxCodec,
  refine: (self, base) => ({
    layers: [...base.layers, GlobPort.layer],
    bodies: [
      ...base.bodies,
      new Body({
        feature: NAME,
        sigil: '@',
        pattern: PATTERN,
        accepts: ['lead', 'prefix'],
        priority: 15,
        label: quoted,
        codec: syntaxCodec,
      }),
    ],
    walk: (pattern, cwd, respect) =>
      Effect.gen(function* () {
        const frame = yield* Ambient.Current
        const port = yield* GlobPort
        return yield* port.walk(pattern, cwd, frame.root, respect)
      }).pipe(Effect.provide(GlobPort.layer)),
    interpret: (node) => {
      const token = node.payload
      return owns(NAME)(node) && Schema.is(GlobToken)(token)
        ? Effect.gen(function* () {
            const frame = yield* Ambient.Current
            const { pattern } = token
            const respect = !anchored(pattern)
            const nearby = frame.scope === frame.root ? [] : yield* self.walk(pattern, frame.scope, respect)
            const files =
              nearby.length > 0 ? nearby : yield* self.walk(pattern, isAbsolute(pattern) ? '/' : frame.root, respect)
            if (files.length === 0) {
              return yield* new Fault({
                code: 'no-match',
                message: `${pattern} matched no files`,
                subject: pattern,
                hint: 'check the pattern or your ignore rules',
              })
            }
            if (files.length > LIMIT) {
              return yield* new Fault({
                code: 'too-many',
                message: `${pattern} matched ${files.length} files`,
                subject: pattern,
                hint: `narrow it below ${LIMIT}`,
              })
            }
            return yield* Effect.forEach(files, (file) => self.open(resolve(file)), { concurrency: 16 })
          })
        : base.interpret(node)
    },
  }),
})
