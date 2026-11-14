/*
 * Shell substitution tokens that run a command in a child shell rooted at the
 * working directory and capture its output with timing, exit status, error
 * stream and any directory change, while also lending subprocess execution to
 * features that need to call out to the operating system.
 */
import { platform } from 'node:process'
import { Context, Effect, Layer, Schema, SchemaGetter } from 'effect'
import spawn, { SubprocessError } from 'nano-spawn'
import { Ambient } from '../kernel/index.ts'
import { Body, Fault, Source, Spawned, flag, value, verbatim } from '../program/model.ts'
import { Feature, defineFeature, owns, whole } from '../program/program.ts'

const NAME = 'shell'

const PATTERN = '`[^`\\n]+`'

const MARK = '\u001e'

class ShellToken extends Schema.Class<ShellToken>('uncat/shell/ShellToken')({
  command: Schema.String.check(
    Schema.isPattern(/^[^`\n]+$/, {
      arbitraryConstraint: { patterns: [{ source: '^[a-z][a-z0-9 _.-]{0,15}$', flags: '' }] },
    }),
  ),
}) {}

const syntaxCodec = Schema.String.check(Schema.isPattern(new RegExp(`^${PATTERN}$`))).pipe(
  Schema.decodeTo(ShellToken, {
    decode: SchemaGetter.transform((text: string) => ({ command: text.slice(1, -1) })),
    encode: SchemaGetter.transform((token: { readonly command: string }) => `\`${token.command}\``),
  }),
)

const timeout = value({
  key: 'timeout',
  description: 'Milliseconds a shell token may run before it is stopped',
  placeholder: '<ms>',
  codec: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
  fallback: 30_000,
})

const enabled = flag({ key: 'shell', description: 'Run shell tokens (disable with --no-shell)', fallback: true })

const invocation = (command: string): readonly [string, ReadonlyArray<string>] =>
  platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', command]]
    : ['sh', ['-c', `trap 'printf "\\n${MARK}%s" "$PWD"' EXIT\n${command}`]]

const settle = (stdout: string, stderr: string, exitCode: number, durationMs: number, cwd: string): Spawned => {
  const cut = stdout.lastIndexOf(`\n${MARK}`)
  return cut === -1
    ? new Spawned({ stdout, stderr, exitCode, durationMs, cwd })
    : new Spawned({
        stdout: stdout.slice(0, cut).replace(/\n$/, ''),
        stderr,
        exitCode,
        durationMs,
        cwd: stdout.slice(cut + 2),
      })
}

class ShellPort extends Context.Service<ShellPort>()('uncat/shell/ShellPort', {
  make: Effect.sync(() => ({
    run: (command: string, cwd: string, ms: number): Effect.Effect<Spawned, Fault> =>
      Effect.tryPromise({
        try: async () => {
          const [file, args] = invocation(command)
          try {
            const result = await spawn(file, args, { cwd, timeout: ms })
            return settle(result.stdout, result.stderr, 0, result.durationMs, cwd)
          } catch (error) {
            if (error instanceof SubprocessError && error.exitCode !== undefined) {
              return settle(error.stdout, error.stderr, error.exitCode, error.durationMs, cwd)
            }
            throw error
          }
        },
        catch: (cause) =>
          new Fault({
            code: cause instanceof SubprocessError && cause.signalName !== undefined ? 'timeout' : 'spawn',
            message: `\`${command}\` failed: ${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)}`,
            subject: command,
            hint:
              cause instanceof SubprocessError && cause.signalName !== undefined
                ? `raise --timeout above ${ms}`
                : 'check that the command exists',
          }),
      }),
  })),
}) {
  static readonly layer: Layer.Layer<ShellPort> = Layer.unwrap(
    Effect.sync(() => Layer.effect(ShellPort, ShellPort.make)),
  )
}

export const feature: Feature = defineFeature({
  name: NAME,
  concurrency: 'sequential',
  syntaxCodec,
  refine: (self, base) => ({
    layers: [...base.layers, ShellPort.layer],
    settings: [...base.settings, timeout, enabled],
    bodies: [
      ...base.bodies,
      new Body({
        feature: NAME,
        sigil: '!',
        pattern: PATTERN,
        accepts: ['lead', 'prefix'],
        priority: 10,
        label: verbatim,
        codec: syntaxCodec,
      }),
    ],
    spawn: (command) =>
      Effect.gen(function* () {
        const frame = yield* Ambient.Current
        const port = yield* ShellPort
        return yield* port.run(command, frame.root, yield* timeout.read)
      }).pipe(Effect.provide(ShellPort.layer)),
    interpret: (node) => {
      const token = node.payload
      return owns(NAME)(node) && Schema.is(ShellToken)(token)
        ? Effect.gen(function* () {
            const { command } = token
            if (!(yield* enabled.read)) {
              return yield* new Fault({
                code: 'disabled',
                message: `shell token \`${command}\` skipped`,
                subject: command,
                hint: 'drop --no-shell to run it',
              })
            }
            const frame = yield* Ambient.Current
            const result = yield* self.spawn(command)
            const attrs: Array<readonly [string, string]> = [
              ['cmd', command],
              ['exit', String(result.exitCode)],
              ['ms', String(Math.round(result.durationMs))],
            ]
            if (result.cwd !== frame.root) attrs.push(['cwd', result.cwd])
            if (result.stderr !== '') attrs.push(['stderr', result.stderr])
            return [
              new Source({
                tag: 'shell',
                attrs,
                identity: '',
                label: command,
                scope: frame.scope,
                kind: 'stdout',
                text: result.stdout,
                extent: whole,
              }),
            ]
          })
        : base.interpret(node)
    },
  }),
})
