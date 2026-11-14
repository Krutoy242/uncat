/*
 * Generates the README terminal demo from real command runs, capturing the
 * prompt as shown by bat, the live uncat session and the expanded result as
 * SVG screenshots so the documentation never drifts from actual behaviour.
 */
import { mkdir, rm } from 'node:fs/promises'
import spawn from 'nano-spawn'

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
