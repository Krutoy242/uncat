/*
 * Library facade offering the same capabilities as the command line, both as
 * Effect values for composition and as promises for plain callers, built on
 * the one synthesized program so behaviour never drifts between surfaces.
 */
import { Effect } from 'effect'
import { Fault, Outcome } from './program/model.ts'
import { Request, execute } from './program/run.ts'
import { program } from './program/synthesis.ts'

export { Chunk, Diagnostic, Fault, OutputFile, Outcome, Position, Report } from './program/model.ts'

export const run = (request: {
  readonly input?: string
  readonly output?: string
  readonly text?: string
  readonly settings?: Readonly<Record<string, unknown>>
  readonly present?: boolean
}): Effect.Effect<Outcome, Fault> =>
  execute(
    program,
    new Request({
      input: request.input,
      output: request.output,
      text: request.text,
      settings: request.settings ?? {},
      present: request.present ?? false,
    }),
  )

export const uncat = (request: Parameters<typeof run>[0]): Promise<Outcome> => Effect.runPromise(run(request))

export const expand = async (text: string, settings?: Readonly<Record<string, unknown>>): Promise<string> =>
  (await uncat({ text, settings: settings ?? {} })).text
