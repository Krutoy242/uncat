/*
 * Generates the README terminal demo using evp and keeps the syntax block
 * in the readme synchronized with the active grammar.
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
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

await rm('demo/prompt_.md', { force: true })
try {
  if (process.platform === 'win32') {
    await spawn('wsl', ['-d', 'alpine', 'evp', 'demo.tape'], { stdio: 'inherit' })
  } else {
    await spawn('evp', ['demo.tape'], { stdio: 'inherit' })
  }
} catch (error) {
  console.warn('evp is not installed locally; demo rendering skipped (CI renders via HalFrgrd/evp action)', error)
} finally {
  await rm('demo/prompt_.md', { force: true })
}
