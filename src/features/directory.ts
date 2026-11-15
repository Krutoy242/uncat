/*
 * Directory tokens marked by a trailing slash that render the folder as an
 * indented tree of its non-ignored entries, giving an agent the shape of a
 * project without dumping the contents of every file it contains.
 */
import { relative, sep } from 'node:path'
import { Effect, Schema, SchemaGetter } from 'effect'
import { Ambient } from '../kernel/index.ts'
import { Body, Fault, Source, identityOf, quoted } from '../program/model.ts'
import { Feature, defineFeature, owns, whole } from '../program/program.ts'

const NAME = 'directory'

const BODY = String.raw`(?:[A-Za-z]:(?=[\\/]))?(?:[\p{L}\p{N}_~+%@-]|\.(?=$|[\p{L}\p{N}_~+%@./-])|/(?=[\p{L}\p{N}_~+%@.-]))+`

const PATTERN = `${BODY}/`

const LIMIT = 2_000

class DirectoryToken extends Schema.Class<DirectoryToken>('uncat/directory/DirectoryToken')({
  path: Schema.String.check(
    Schema.isPattern(new RegExp(`^${BODY}$`, 'u'), {
      arbitraryConstraint: {
        patterns: [{ source: '^\\.?[a-z0-9_-]{1,8}(?:/\\.?[a-z0-9_-]{1,8}){0,2}$', flags: '' }],
      },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.pipe(
  Schema.decodeTo(DirectoryToken, {
    decode: SchemaGetter.transform((text: string) => ({ path: text.slice(0, -1) })),
    encode: SchemaGetter.transform((token: { readonly path: string }) => `${token.path}/`),
  }),
)

class Tree {
  readonly folders: Map<string, Tree> = new Map()
  readonly files: Array<string> = []
  add(parts: ReadonlyArray<string>): void {
    const [head, ...rest] = parts
    if (head === undefined) return
    if (rest.length === 0) {
      this.files.push(head)
      return
    }
    const child = this.folders.get(head) ?? new Tree()
    this.folders.set(head, child)
    child.add(rest)
  }
  lines(indent: string): ReadonlyArray<string> {
    const entries = [
      ...[...this.folders.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, tree]) => [`${name}/`, tree] as const),
      ...this.files.toSorted((a, b) => a.localeCompare(b)).map((name) => [name, undefined] as const),
    ]
    return entries.flatMap(([name, tree], index) => {
      const last = index === entries.length - 1
      const line = `${indent}${last ? '└── ' : '├── '}${name}`
      return tree === undefined ? [line] : [line, ...tree.lines(`${indent}${last ? '    ' : '│   '}`)]
    })
  }
}

export const feature: Feature = defineFeature({
  name: NAME,
  requires: ['glob'],
  syntaxCodec,
  refine: (self, base) => ({
    bodies: [
      ...base.bodies,
      new Body({
        feature: NAME,
        sigil: '@',
        pattern: PATTERN,
        accepts: ['lead', 'prefix'],
        priority: 12,
        label: quoted,
        codec: syntaxCodec,
        description: 'Directory tree',
        samples: [new DirectoryToken({ path: 'path' })],
      }),
    ],
    interpret: (node) => {
      const token = node.payload
      return owns(NAME)(node) && Schema.is(DirectoryToken)(token)
        ? Effect.gen(function* () {
            const frame = yield* Ambient.Current
            const { path } = token
            const located = yield* self.locate(path)
            if (located === undefined) {
              return yield* new Fault({ code: 'not-found', message: `cannot find ${path}/`, subject: path, hint: '' })
            }
            const files = yield* self.walk('**/*', located, true)
            const tree = new Tree()
            for (const file of files.slice(0, LIMIT)) tree.add(relative(located, file).split(sep))
            const more = files.length > LIMIT ? [`… ${files.length - LIMIT} more`] : []
            const shown = relative(frame.root, located).split(sep).join('/') || '.'
            return [
              new Source({
                tag: 'dir',
                attrs: [['path', `${shown}/`]],
                identity: identityOf('dir', located),
                label: `${path}/`,
                scope: located,
                kind: 'tree',
                text: [`${shown}/`, ...tree.lines(''), ...more].join('\n'),
                extent: whole,
              }),
            ]
          })
        : base.interpret(node)
    },
  }),
})
