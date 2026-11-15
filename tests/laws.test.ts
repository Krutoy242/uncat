/*
 * Universal law runner that derives every case from the discovered features'
 * own codecs and grammar tables, checking round trips, recognition of printed
 * tokens, literal readings, quota conservation and idempotent expansion
 * without naming a single feature or writing a single concrete token.
 */
import { join } from 'node:path'
import { assert, describe, expect, it } from '@effect/vitest'
import { Arbitrary, Effect, Exit, Schema } from 'effect'
import * as mr from 'multi-integer-range'
import { discoveredFeatures } from 'virtual:ahead-features'
import { recognize } from '../src/program/engine.ts'
import { applicable, decode, encode, print, syntaxOf } from '../src/program/grammar.ts'
import { Source } from '../src/program/model.ts'
import { verdict, whole } from '../src/program/program.ts'
import { settingsOf } from '../src/program/run.ts'
import { program } from '../src/program/synthesis.ts'
import { expandText, plant, scratch, within } from './harness.ts'

const Word = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,12}$/))

const prose = Arbitrary.schema(Schema.Struct({ left: Word, right: Word }))

const json = (value: unknown): string => JSON.stringify(value)

const sorted = (record: Readonly<Record<string, string>>): string =>
  json(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)))

const matchCache = new Map<string, Arbitrary.Arbitrary<string>>()

const matching = (pattern: string): Arbitrary.Arbitrary<string> => {
  const cached = matchCache.get(pattern)
  if (cached !== undefined) return cached
  const arb = Arbitrary.schema(Schema.String.check(Schema.isPattern(new RegExp(`^(?:${pattern})$`, 'u'))))
  matchCache.set(pattern, arb)
  return arb
}

const flagsOn: Readonly<Record<string, unknown>> = Object.fromEntries(
  settingsOf(program)
    .filter((setting) => setting.kind === 'flag')
    .map((setting) => [setting.key, true]),
)

const cwd = process.cwd()

const tokenCache = new Map<
  string,
  Arbitrary.Arbitrary<{
    readonly ast: unknown
    readonly marks: Readonly<Record<string, string>>
    readonly token: string
  }>
>()

const tokens = (body: (typeof program.bodies)[number], positions: ReadonlyArray<'lead' | 'prefix' | 'suffix'>) => {
  const key = `${body.feature}:${positions.join(',')}`
  const cached = tokenCache.get(key)
  if (cached !== undefined) return cached
  const fragments = program.fragments.filter(
    (fragment) => applicable(fragment, body) && positions.includes(fragment.position),
  )
  const marks = Arbitrary.all(
    fragments.map((fragment) =>
      Arbitrary.all([
        Arbitrary.schema(Schema.Boolean),
        Arbitrary.filter(matching(fragment.pattern(body.sigil)), (text) =>
          Exit.isSuccess(decode(fragment.codec, text)),
        ),
      ]),
    ),
  )
  const arb = Arbitrary.map(Arbitrary.all([Arbitrary.schema(body.codec), marks]), ([ast, picks]) => {
    const chosen = Object.fromEntries(
      fragments.flatMap((fragment, index) => {
        const [on, text] = picks[index] ?? [false, '']
        return on ? [[fragment.feature, text] as const] : []
      }),
    )
    return { ast, marks: chosen, token: print(body, encode(body.codec, ast), program.fragments, chosen) }
  })
  tokenCache.set(key, arb)
  return arb
}

describe('codec isomorphism', () => {
  for (const feature of discoveredFeatures) {
    const codec = feature.syntaxCodec
    if (codec === undefined) continue
    it.effect(`${feature.name} decodes every encoding back to itself`, () =>
      Effect.gen(function* () {
        const decodeAll = Schema.decodeUnknownSync(codec)
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.schema(codec),
          (ast) => Effect.sync(() => json(decodeAll(encode(codec, ast))) === json(ast)),
          { runs: 5, seed: 42 },
        )
        expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
      }),
    )
  }
})

describe('grammar product recognition', () => {
  for (const body of program.bodies) {
    it.effect(`${body.feature} tokens with any applicable marks are recognized as themselves`, () =>
      Effect.gen(function* () {
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.all([prose, tokens(body, ['lead', 'prefix', 'suffix'])]),
          ([{ left, right }, { ast, marks, token }]) =>
            Effect.map(recognize(program, `${left} ${token} ${right}`, whole), (nodes) => {
              const [node] = nodes
              return (
                nodes.length === 1 &&
                node !== undefined &&
                node.meta.feature === body.feature &&
                node.meta.span.start === left.length + 1 &&
                node.meta.span.end === left.length + 1 + token.length &&
                json(node.payload) === json(ast) &&
                sorted(node.meta.marks) === sorted(marks)
              )
            }).pipe(within(cwd)),
          { runs: 5, seed: 7 },
        )
        expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
      }),
    )
  }

  for (const scanner of program.scanners) {
    const codec = scanner.codec
    it.effect(`${scanner.feature} finds every encoding embedded in prose`, () =>
      Effect.gen(function* () {
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.all([prose, Arbitrary.schema(codec)]),
          ([{ left, right }, ast]) => {
            const token = encode(codec, ast)
            return Effect.map(
              recognize(program, `${left} ${token} ${right}`, whole),
              (nodes) =>
                nodes.length === 1 &&
                nodes[0]?.meta.feature === scanner.feature &&
                json(nodes[0].payload) === json(ast),
            ).pipe(within(cwd, flagsOn))
          },
          { runs: 5, seed: 11 },
        )
        expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
      }),
    )
  }

  const entries = syntaxOf(program)

  it('every feature with a syntaxCodec contributes non-empty documented syntax', () => {
    const documented = new Map(entries.map((entry) => [entry.feature, entry]))
    for (const feature of discoveredFeatures) {
      if (feature.syntaxCodec === undefined) continue
      const entry = documented.get(feature.name)
      assert.isDefined(entry, `${feature.name} is missing from syntaxOf(program)`)
      assert.isAbove(entry.tokens.length, 0, `${feature.name} has no syntax sample tokens`)
      assert.notStrictEqual(entry.description.trim(), '', `${feature.name} has an empty description`)
    }
  })

  for (const entry of entries) {
    it.effect(`${entry.feature} documented syntax tokens are recognized as full tokens`, () =>
      Effect.gen(function* () {
        for (const token of entry.tokens) {
          const nodes = yield* recognize(program, `left ${token} right`, whole).pipe(within(cwd, flagsOn))
          const [node] = nodes
          assert.isTrue(
            nodes.length === 1 &&
              node !== undefined &&
              node.meta.text === token &&
              (node.meta.feature === entry.feature || node.meta.marks[entry.feature] !== undefined),
            `${entry.feature}: ${token}`,
          )
        }
      }),
    )
  }

  for (const body of program.bodies) {
    it.effect(`${body.feature} extent evaluation is valid across arbitrary line counts`, () =>
      Effect.gen(function* () {
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.all([
            prose,
            tokens(body, ['lead', 'prefix', 'suffix']),
            Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 100 }))),
          ]),
          ([{ left, right }, { token }, total]) =>
            Effect.map(recognize(program, `${left} ${token} ${right}`, whole), (nodes) => {
              const [node] = nodes
              if (node === undefined) return false
              const ext = program.extent(node, total)
              const min = mr.min(ext)
              return ext.length === 0 || (min !== undefined && min >= 1)
            }).pipe(within(cwd, flagsOn)),
          { runs: 5, seed: 19 },
        )
        expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
      }),
    )
  }
})

describe('literal readings', () => {
  for (const body of program.bodies) {
    it.effect(`${body.feature} tokens with a literal reading splice exactly that reading`, () =>
      Effect.gen(function* () {
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.all([prose, tokens(body, ['lead', 'prefix', 'suffix'])]),
          ([{ left, right }, { token }]) =>
            Effect.gen(function* () {
              const text = `${left} ${token} ${right}`
              const [node] = yield* recognize(program, text, whole)
              if (node === undefined) return false
              const literal = program.literal(node)
              const leads = program.fragments.filter(
                (fragment) => fragment.position === 'lead' && node.meta.marks[fragment.feature] !== undefined,
              )
              if (
                leads.length > 0 &&
                literal?.text !==
                  token.slice(
                    leads.reduce((size, fragment) => size + (node.meta.marks[fragment.feature] ?? '').length, 0),
                  )
              )
                return false
              if (literal === undefined) return true
              const expected =
                literal.collapse && literal.text === '' ? `${left} ${right}` : `${left} ${literal.text} ${right}`
              return (yield* expandText(text)) === expected
            }).pipe(within(cwd)),
          { runs: 5, seed: 13 },
        )
        expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
      }),
    )
  }
})

describe('quota conservation', () => {
  const numeric = settingsOf(program).filter((setting) => typeof setting.fallback === 'number')
  const short = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[a-z \n]{0,10}$/)))
  const long = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[a-z \n]{240,600}$/)))
  it.effect.prop(
    'payload transforms keep head plus tail plus hidden equal to the original',
    [
      Arbitrary.flatMap(Arbitrary.schema(Schema.Boolean), (big) => (big ? long : short)),
      Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 12, maximum: 200 }))),
    ],
    ([text, limit]) =>
      Effect.gen(function* () {
        const source = new Source({
          tag: 'probe',
          attrs: [],
          identity: '',
          label: 'probe',
          scope: cwd,
          kind: 'txt',
          text,
          extent: whole,
        })
        const payload = yield* program.payload(source, text)
        if (payload.hidden === 0) return payload.body === text && text.length <= limit
        let prefix = 0
        while (prefix < text.length && payload.body[prefix] === text[prefix]) prefix++
        let suffix = 0
        while (
          suffix < text.length - prefix &&
          payload.body[payload.body.length - 1 - suffix] === text[text.length - 1 - suffix]
        )
          suffix++
        return prefix + suffix + payload.hidden === text.length && payload.body.length < text.length
      }).pipe(within(cwd, Object.fromEntries(numeric.map((setting) => [setting.key, limit])))),
    { arbitrary: { runs: 5, seed: 5 } },
  )
})

const yieldBody = (index: number): (typeof program.bodies)[number] => {
  const body = program.bodies.at(index % Math.max(1, program.bodies.length))
  if (body === undefined) throw new Error('the synthesized program contributes no token bodies')
  return body
}

const PATHLIKE = /^\.?[a-z0-9_ -]+(?:\/\.?[a-z0-9_ -]+)*\.[a-z]{1,3}$/

const DIRLIKE = /^\.?[a-z0-9_ -]+(?:\/\.?[a-z0-9_ -]+)*$/

const materialize = (raw: string): ReadonlyArray<string> => {
  const clean = (raw.split('#')[0] ?? '').replace(/\*\*\//g, '.d/').replace(/\*/g, 'leaf')
  return PATHLIKE.test(clean) ? [clean] : DIRLIKE.test(clean) ? [`${clean}/.leaf.txt`] : []
}

const pathsIn = (value: unknown): ReadonlyArray<string> =>
  value !== null && typeof value === 'object'
    ? Object.values(value).flatMap(pathsIn)
    : typeof value === 'string'
      ? materialize(value)
      : []

const canonical = (text: string): ReadonlyArray<string> =>
  program.chunks(text).flatMap((chunk) => (chunk.identity === '' ? [] : [chunk.identity]))

const unique = (items: ReadonlyArray<string>): boolean => new Set(items).size === items.length

const interpolating = (text: string) =>
  Effect.map(recognize(program, text, whole), (nodes) =>
    nodes.some(
      (node) =>
        !verdict(
          program.enveloping.map((policy) => policy(node)),
          true,
        ),
    ),
  )

describe('expansion over a scratch project', () => {
  const lines = Arbitrary.array(
    Arbitrary.all([
      Arbitrary.schema(
        Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Math.max(0, program.bodies.length - 1) })),
      ),
      Arbitrary.schema(Schema.Literals(['standalone', 'inline', 'fenced'])),
      prose,
    ]),
    { maxLength: 3 },
  )
  const documents = Arbitrary.flatMap(lines, (shape) =>
    Arbitrary.map(Arbitrary.all(shape.map(([index]) => tokens(yieldBody(index), ['prefix', 'suffix']))), (generated) =>
      generated.flatMap((sample, position) => {
        const row = shape[position]
        return row === undefined ? [] : [[row, sample] as const]
      }),
    ),
  )

  const scenario = (
    law: (fixture: {
      readonly root: string
      readonly text: string
      readonly fenced: ReadonlyArray<string>
    }) => Effect.Effect<boolean>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* scratch
        let runId = 0
        const result = yield* Arbitrary.checkEffect(
          documents,
          (rows) =>
            Effect.gen(function* () {
              const runDir = join(root, `r${runId++}`)
              const files = Object.fromEntries(
                rows.flatMap(([, sample]) =>
                  pathsIn(sample.ast).map((path) => [path, `${path} body\n`] as const),
                ),
              )
              yield* plant(runDir, files)
              const blocks = rows.map(([[, place, { left, right }], { token }]) =>
                place === 'standalone'
                  ? token
                  : place === 'inline'
                    ? `${left} ${token} ${right}`
                    : `~~~~\n${token}\n~~~~`,
              )
              const fenced = blocks.filter((_, index) => rows[index]?.[0][1] === 'fenced')
              return yield* law({ root: runDir, text: blocks.join('\n\n'), fenced })
            }),
          { runs: 2, seed: 3 },
        )
        expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
      }),
    )

  it.live('expanding an expansion changes nothing when no payload is interpolated', () =>
    scenario(({ root, text }) =>
      Effect.gen(function* () {
        if (yield* interpolating(text)) return true
        const once = yield* expandText(text)
        return (yield* expandText(once)) === once
      }).pipe(within(root)),
    ),
  )

  it.live('doubling a document never doubles a canonical source', () =>
    scenario(({ root, text }) =>
      Effect.map(expandText(`${text}\n\n${text}`), (output) => unique(canonical(output))).pipe(within(root)),
    ),
  )

  it.live('sources already present in the input are attested instead of repeated', () =>
    scenario(({ root, text }) =>
      Effect.gen(function* () {
        const once = yield* expandText(text)
        return unique(canonical(yield* expandText(`${once}\n\n${text}`)))
      }).pipe(within(root)),
    ),
  )

  it.live('host-language code blocks survive verbatim', () =>
    scenario(({ root, text, fenced }) =>
      Effect.map(expandText(text), (output) => fenced.every((block) => output.includes(block))).pipe(within(root)),
    ),
  )

  assert.isTrue(program.bodies.length > 0)
})
