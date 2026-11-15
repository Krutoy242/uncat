/*
 * Generates the README terminal demo from real command runs, capturing the
 * prompt as shown by bat, the live uncat session and the expanded result as
 * SVG screenshots so the documentation never drifts from actual behaviour.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import spawn from 'nano-spawn'
import { formatSyntaxMarkdown } from '../src/program/grammar.ts'
import { program } from '../src/program/synthesis.ts'

const SYNTAX_BLOCK = /(<!--\s*syntax:start\b[^>]*-->\r?\n)([\s\S]*?)(\r?\n<!--\s*syntax:end\b[^>]*-->)/

const readme = await readFile('README.md', 'utf8')
if (!SYNTAX_BLOCK.test(readme)) throw new Error('README.md lacks syntax:start / syntax:end markers')
await writeFile(
  'README.md',
  readme.replace(SYNTAX_BLOCK, (_, open: string, _body: string, close: string) => {
    const formatted = formatSyntaxMarkdown(program)
    return `${open}${open.endsWith('\r\n') ? formatted.replaceAll('\n', '\r\n') : formatted}${close}`
  }),
)

if (process.argv.includes('--syntax-only')) {
  process.exit(0)
}

const shots: ReadonlyArray<readonly [string, string]> = [
  ['docs/demo-input.svg', 'bat --color=always --style=plain --language=markdown demo/prompt.md'],
  ['docs/demo-run.svg', 'node dist/cli.mjs demo/prompt.md --mode hud'],
  ['docs/demo-output.svg', 'bat --color=always --style=plain --language=xml demo/prompt_.md'],
]

await mkdir('docs', { recursive: true })
await rm('demo/prompt_.md', { force: true })
for (const [output, command] of shots) {
  await spawn(
    'freeze',
    ['--execute', command, '--output', output, '--window', '--padding', '20', '--font.size', '12'],
    {
      stdio: 'inherit',
    },
  )
}
