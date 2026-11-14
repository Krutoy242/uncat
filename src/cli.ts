#!/usr/bin/env node
/*
 * Command-line entry that derives every flag from the settings contributed by
 * the synthesized features and hands the parsed request to the shared service,
 * so the terminal surface grows automatically whenever a feature is added.
 */
import { cli } from 'cleye'
import { Cause, Effect, Exit, Schema } from 'effect'
import packageJson from '../package.json' with { type: 'json' }
import { Request, execute, settingsOf } from './program/run.ts'
import { program } from './program/synthesis.ts'

const flags = Object.fromEntries(
  settingsOf(program).map((setting) => [
    setting.key,
    {
      type: setting.kind === 'flag' ? Boolean : Schema.toStandardSchemaV1(setting.codec),
      description: setting.description,
      default: setting.fallback,
      ...(setting.alias === '' ? {} : { alias: setting.alias }),
      ...(setting.placeholder === '' ? {} : { placeholder: setting.placeholder }),
    },
  ]),
)

const argv = cli({
  name: 'uncat',
  version: packageJson.version,
  parameters: ['[input]', '[output]'],
  flags,
  strictFlags: true,
  booleanFlagNegation: true,
  help: {
    description: packageJson.description,
    examples: [
      'uncat prompt.md',
      'uncat prompt.md context.md',
      'echo "@src/index.ts" | uncat',
      'uncat notes.md --mode json',
    ],
  },
})

const exit = await Effect.runPromiseExit(
  execute(
    program,
    new Request({
      input: argv._.input,
      output: argv._.output,
      text: undefined,
      settings: Object.fromEntries(Object.entries(argv.flags).filter(([key]) => key !== 'help' && key !== 'version')),
      present: true,
    }),
  ),
)

if (Exit.isSuccess(exit)) {
  process.exitCode = exit.value.report.diagnostics.some((diagnostic) => diagnostic.depth === 0) ? 1 : 0
} else {
  const error = Cause.squash(exit.cause)
  const hint = error instanceof Error && 'hint' in error && error.hint !== '' ? `\n  ${String(error.hint)}` : ''
  process.stderr.write(`uncat: ${error instanceof Error ? error.message : String(error)}${hint}\n`)
  process.exitCode = 2
}
