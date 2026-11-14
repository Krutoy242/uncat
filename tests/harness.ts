/*
 * Shared harness for the law suites that runs effects inside an ambient frame
 * rooted at a scratch directory with every setting at its declared default,
 * so each law can override only the settings it is actually about.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, Scope } from 'effect'
import * as Ambient from '../src/kernel/ambient.ts'
import { expand, render } from '../src/program/engine.ts'
import { settingsOf, shared } from '../src/program/run.ts'
import { program } from '../src/program/synthesis.ts'

export const defaults: Readonly<Record<string, unknown>> = Object.fromEntries(
  settingsOf(program).map((setting) => [setting.key, setting.fallback]),
)

export const within =
  (root: string, settings: Readonly<Record<string, unknown>> = {}) =>
  <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.provideService(
        Ambient.Current,
        new Ambient.Frame({
          correlationId: 't',
          scope: root,
          root,
          depth: 0,
          lineage: [],
          settings: { ...defaults, shell: false, mode: 'raw', ...settings },
        }),
      ),
      Effect.provide(shared(program)),
    )

export const expandText = (text: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const attested = yield* program.attest(text)
    return yield* render(program, yield* expand(program, text), attested)
  })

export const scratch: Effect.Effect<string, never, Scope.Scope> = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'uncat-laws-'))),
  (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
)

export const plant = (root: string, files: Readonly<Record<string, string>>): Effect.Effect<void> =>
  Effect.promise(async () => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), text)
    }
  })
