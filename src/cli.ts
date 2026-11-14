#!/usr/bin/env node
/*
 * Command-line entry that derives flags from the synthesized features and hands
 * the request to the shared service, colorizing help and mapping diagnostics.
 */
import { stripVTControlCharacters, styleText } from 'node:util'
import { cli } from 'cleye'
import { Cause, Effect, Exit, Schema } from 'effect'
import packageJson from '../package.json' with { type: 'json' }
import { Request, execute, settingsOf } from './program/run.ts'
import { program } from './program/synthesis.ts'

const noColor = process.env['NO_COLOR'] !== undefined
const paint = (format: Parameters<typeof styleText>[0], text: string): string =>
  noColor ? text : styleText(format, text, { validateStream: false })

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
    render: (nodes, renderers) => {
      renderers.heading = (text: string) => paint(['bold', 'cyan'], text)
      const originalText = renderers.text.bind(renderers)
      renderers.text = (text: string) => {
        if (text.startsWith(`uncat v${packageJson.version}`)) {
          return `${paint(['bold', 'cyan'], 'uncat')} ${paint('dim', `v${packageJson.version}`)}\n`
        }
        return originalText(text)
      }
      renderers.flagName = (data) => {
        const { flag, flagFormatted, aliasesEnabled, aliasFormatted } = data
        let prefix = ''
        if (aliasFormatted) prefix = `${paint('yellow', aliasFormatted)}, `
        else if (aliasesEnabled) prefix = '    '
        const nameStr = paint('green', flagFormatted)
        let param = ''
        if ('placeholder' in flag && typeof flag.placeholder === 'string') {
          param = ` ${paint('magenta', flag.placeholder)}`
        } else {
          const p = renderers.flagParameter('type' in flag ? flag.type : flag)
          if (p) param = ` ${paint('magenta', p)}`
        }
        return `${prefix}${nameStr}${param}`
      }
      renderers.flagDefault = (value) => paint('yellow', JSON.stringify(value))
      renderers.table = ({ tableData }) => {
        const renderedRows = tableData.map((row) => row.map((cell) => renderers.render(cell)))
        const widths = renderedRows.reduce<Array<number>>((acc, row) => {
          row.forEach((cell, index) => {
            acc[index] = Math.max(acc[index] ?? 0, stripVTControlCharacters(cell).length)
          })
          return acc
        }, [])
        return renderedRows
          .map(
            (row) =>
              `  ${row
                .map((cell, index) =>
                  index + 1 === row.length
                    ? cell
                    : `${cell}${' '.repeat(Math.max(0, (widths[index] ?? 0) - stripVTControlCharacters(cell).length))}`,
                )
                .join('   ')}`,
          )
          .join('\n')
      }
      const originalSection = renderers.section.bind(renderers)
      renderers.section = (options) => {
        if (options.title?.toLowerCase().includes('example') && typeof options.body === 'string') {
          const body = options.body
            .split('\n')
            .map((line: string) => paint('cyan', line))
            .join('\n')
          return originalSection({ ...options, body })
        }
        return originalSection(options)
      }
      return renderers.render(nodes)
    },
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
