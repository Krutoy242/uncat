/*
 * Structural invariants of the code base checked directly on its sources:
 * no type-only module syntax or escape-hatch types, no feature imported by
 * name, a kernel with no outward dependencies, and one-sentence file headers.
 */
import { readFile } from 'node:fs/promises'
import { basename, relative } from 'node:path'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { glob } from 'tinyglobby'

const root = new URL('..', import.meta.url).pathname

const sources = Effect.promise(async () => {
  const files = await glob(['src/**/*.ts', 'tests/**/*.ts', 'build/**/*.ts', 'scripts/**/*.ts', '*.ts'], {
    cwd: root,
    absolute: true,
  })
  return Promise.all(files.map(async (file) => ({ file: relative(root, file), text: await readFile(file, 'utf8') })))
})

const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
  ['type-only import', /^\s*import\s+type\b|import\s*\{[^}]*\btype\s+\w/m],
  ['type export', /^\s*export\s+(?:type|interface)\b|export\s*\{[^}]*\btype\s+\w/m],
  ['explicit any', /(?::|<|\bas)\s*any\b/],
  ['unsafe double cast', /\bas\s+unknown\s+as\b/],
  ['non-erasable enum', /^\s*(?:export\s+)?(?:const\s+)?enum\s/m],
  ['runtime namespace', /^\s*(?:export\s+)?namespace\s/m],
]

describe('architecture', () => {
  it.effect('no module uses type-only syntax, any, double casts, enums or namespaces', () =>
    Effect.gen(function* () {
      for (const { file, text } of yield* sources) {
        for (const [rule, pattern] of forbidden) assert.notMatch(text, pattern, `${file}: ${rule}`)
      }
    }),
  )

  it.effect('features are only ever reached through discovery', () =>
    Effect.gen(function* () {
      for (const { file, text } of yield* sources) {
        assert.notMatch(text, /from\s+['"][^'"]*\/features\/[^'"]*['"]/, `${file} imports a feature by name`)
      }
    }),
  )

  it.effect('feature modules export exactly one feature', () =>
    Effect.gen(function* () {
      for (const { file, text } of (yield* sources).filter((source) => source.file.startsWith('src/features/'))) {
        const exported = [...text.matchAll(/^export\s+(?:const|class|function|let)\s+(\w+)/gm)].map((match) => match[1])
        assert.deepStrictEqual(exported, ['feature'], file)
      }
    }),
  )

  it.effect('the kernel depends on nothing but itself and the effect system', () =>
    Effect.gen(function* () {
      for (const { file, text } of (yield* sources).filter((source) => source.file.startsWith('src/kernel/'))) {
        for (const [, specifier] of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          assert.isTrue(
            specifier === 'effect' || /^\.\/[\w-]+\.ts$/.test(specifier ?? ''),
            `${file} imports ${specifier}`,
          )
        }
      }
    }),
  )

  it.effect('every source opens with a single wrapped sentence', () =>
    Effect.gen(function* () {
      for (const { file, text } of yield* sources) {
        const body = text.replace(/^#!.*\n/, '')
        const header = /^\/\*\n((?: \*.*\n)+?) \*\/\n/.exec(body)
        assert.isNotNull(header, `${basename(file)} lacks a header comment`)
        const lines = (header?.[1] ?? '').split('\n').filter((line) => line !== '')
        const sentence = lines.map((line) => line.replace(/^ \* ?/, '')).join(' ')
        assert.isTrue(
          lines.every((line) => line.length <= 84),
          `${file}: header lines exceed the wrap width`,
        )
        assert.match(sentence, /^[A-Z][^.!?]*[.]$/, `${file}: header must be exactly one sentence`)
        assert.notMatch(text, /^\s*\/\/\s*\d+[.)]/m, `${file}: numbered comment`)
      }
    }),
  )
})
