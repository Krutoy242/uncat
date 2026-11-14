/*
 * Application service shared by the command line and the library facade,
 * turning one request into an expanded document, written shards and a report
 * so both entry points behave identically for the same settings.
 */
import { writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { text as readAll } from 'node:stream/consumers'
import { Clock, Data, Effect, Layer, Schema } from 'effect'
import { Ambient } from '../kernel/index.ts'
import { diagnostics, expand, render, visit } from './engine.ts'
import { Chunk, Fault, OutputFile, Outcome, Presenter, Report, Setting, Signal, value } from './model.ts'
import { Program } from './program.ts'

export class Request extends Data.Class<{
  readonly input: string | undefined
  readonly output: string | undefined
  readonly text: string | undefined
  readonly settings: Readonly<Record<string, unknown>>
  readonly present: boolean
}> {}

const mode = value({
  key: 'mode',
  description: 'Presentation: auto, raw, or any registered presenter',
  placeholder: '<mode>',
  codec: Schema.String,
  fallback: 'auto',
})

export const settingsOf = (program: Program): ReadonlyArray<Setting<unknown>> => [mode, ...program.settings]

const fault = (code: string, message: string, subject: string, hint: string): Fault =>
  new Fault({ code, message, subject, hint })

const measure = (text: string): { readonly bytes: number; readonly chars: number; readonly lines: number } => ({
  bytes: Buffer.byteLength(text),
  chars: text.length,
  lines: text === '' ? 0 : text.split('\n').length,
})

const raw = new Presenter({
  name: 'raw',
  auto: () => true,
  present: (outcome) =>
    Effect.sync(() => {
      if (outcome.toStdout) process.stdout.write(outcome.text.endsWith('\n') ? outcome.text : `${outcome.text}\n`)
      else for (const output of outcome.report.outputs) process.stdout.write(`${output.path}\n`)
      for (const diagnostic of outcome.report.diagnostics) {
        process.stderr.write(`uncat: ${diagnostic.message}${diagnostic.hint === '' ? '' : ` (${diagnostic.hint})`}\n`)
      }
    }),
})

const resolveSettings = Effect.fnUntraced(function* (program: Program, given: Readonly<Record<string, unknown>>) {
  const known = settingsOf(program)
  const keys = new Set(known.map((setting) => setting.key))
  const stray = Object.keys(given).find((key) => !keys.has(key))
  if (stray !== undefined) {
    return yield* fault('unknown-setting', `unknown setting "${stray}"`, stray, `known: ${[...keys].join(', ')}`)
  }
  const entries = yield* Effect.forEach(known, (setting) =>
    Schema.decodeUnknownEffect(Schema.toType(setting.codec))(given[setting.key] ?? setting.fallback).pipe(
      Effect.map((decoded) => [setting.key, decoded] as const),
      Effect.mapError((issue) =>
        fault('invalid-setting', `invalid value for "${setting.key}"`, setting.key, issue.message),
      ),
    ),
  )
  return Object.fromEntries(entries)
})

const choose = (program: Program, name: unknown): Effect.Effect<Presenter, Fault> => {
  const all = [...program.presenters, raw]
  const chosen =
    name === 'auto' ? all.find((presenter) => presenter.auto()) : all.find((presenter) => presenter.name === name)
  return chosen === undefined
    ? Effect.fail(
        fault(
          'unknown-mode',
          `unknown mode "${String(name)}"`,
          String(name),
          `use auto, ${all.map((presenter) => presenter.name).join(', ')}`,
        ),
      )
    : Effect.succeed(chosen)
}

const defaultTarget = (path: string): string => {
  const extension = extname(path)
  return join(dirname(path), `${basename(path, extension)}_${extension}`)
}

class Origin extends Data.Class<{
  readonly text: string
  readonly scope: string
  readonly identity: string
  readonly target: string | undefined
}> {}

const origin = Effect.fnUntraced(function* (program: Program, request: Request, root: string) {
  if (request.text !== undefined)
    return new Origin({ text: request.text, scope: root, identity: '', target: request.output })
  if (request.input !== undefined && request.input !== '-') {
    const source = yield* program.open(request.input)
    const target = request.output ?? defaultTarget(resolve(root, request.input))
    return new Origin({ text: source.text, scope: source.scope, identity: source.identity, target })
  }
  if (process.stdin.isTTY)
    return yield* fault('no-input', 'nothing to expand', '', 'pipe text into uncat or pass a file path')
  const text = yield* Effect.tryPromise({
    try: () => readAll(process.stdin),
    catch: (cause) => fault('stdin', `cannot read standard input: ${String(cause)}`, '', ''),
  })
  return new Origin({ text, scope: root, identity: '', target: request.output })
})

const persist = Effect.fnUntraced(function* (program: Program, text: string, target: string) {
  const shards = yield* program.split(text)
  return yield* Effect.forEach(shards, (shard, index) =>
    Effect.gen(function* () {
      const path = program.name(target, index + 1, shards.length)
      yield* Effect.tryPromise({
        try: () => writeFile(path, shard),
        catch: (cause) => fault('write', `cannot write ${path}: ${String(cause)}`, path, 'check the output directory'),
      })
      const stats = measure(shard)
      yield* program.observe(
        new Signal({
          kind: 'write',
          id: path,
          parent: '',
          label: path,
          depth: 0,
          bytes: stats.bytes,
          detail: `${index + 1}/${shards.length}`,
        }),
      )
      return [new OutputFile({ path, ...stats }), shard] as const
    }),
  )
})

export const run: (program: Program, request: Request) => Effect.Effect<Outcome, Fault> = Effect.fnUntraced(function* (
  program: Program,
  request: Request,
) {
  const started = yield* Clock.currentTimeMillis
  const settings = yield* resolveSettings(program, request.settings)
  const presenter = yield* choose(program, settings['mode'])
  const root = process.cwd()
  const frame = new Ambient.Frame({
    correlationId: 'u',
    scope: root,
    root,
    depth: 0,
    lineage: [],
    settings: { ...settings, mode: request.present ? presenter.name : 'silent' },
  })
  const outcome = yield* Effect.gen(function* () {
    const input = yield* origin(program, request, root)
    return yield* Effect.gen(function* () {
      yield* program.observe(
        new Signal({
          kind: 'begin',
          id: 'u',
          parent: '',
          label: input.target ?? 'stdout',
          depth: 0,
          bytes: input.text.length,
          detail: '',
        }),
      )
      const attested = yield* program.attest(input.text)
      const tree = yield* expand(program, input.text)
      const rendered = yield* render(program, tree, attested)
      const text = yield* program.finalize(rendered)
      const written = input.target === undefined ? [] : yield* persist(program, text, input.target)
      const chunks =
        input.target === undefined
          ? program.chunks(text)
          : written.flatMap(([file, shard]) =>
              program.chunks(shard).map((chunk) => new Chunk({ ...chunk, file: file.path })),
            )
      let sources = 0
      visit(tree, (_, branch) => {
        if (branch !== undefined) sources += 1
      })
      const elapsedMs = (yield* Clock.currentTimeMillis) - started
      const report = new Report({
        mode: request.present ? presenter.name : 'silent',
        outputs: written.map(([file]) => file),
        chunks,
        diagnostics: diagnostics(tree),
        sources,
        ...measure(text),
        elapsedMs,
      })
      yield* program.observe(
        new Signal({
          kind: 'end',
          id: 'u',
          parent: '',
          label: '',
          depth: 0,
          bytes: report.bytes,
          detail: `${elapsedMs}`,
        }),
      )
      return new Outcome({ text, report, toStdout: input.target === undefined })
    }).pipe(Ambient.within({ scope: input.scope, lineage: input.identity === '' ? [] : [input.identity] }))
  }).pipe(Effect.provideService(Ambient.Current, frame))
  if (request.present) yield* presenter.present(outcome)
  return outcome
})

export const shared = (program: Program): Layer.Layer<never> =>
  program.layers.reduce((merged, layer) => Layer.merge(merged, layer), Layer.empty)

export const execute = (program: Program, request: Request): Effect.Effect<Outcome, Fault> =>
  run(program, request).pipe(Effect.provide(shared(program)))
