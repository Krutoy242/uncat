# uncat 😾

CLI and library for contextual text expansion for AI agents.

<p align="center">
  <img src="docs/demo-input.svg" alt="bat shows a prompt that references files, a folder, a command and a comment" width="32%">
  <img src="docs/demo-run.svg" alt="uncat expands it with a live heads-up display" width="32%">
  <img src="docs/demo-output.svg" alt="bat shows the expanded prompt" width="32%">
</p>

```bash
npm i -g uncat      # zero runtime dependencies, Node.js 26+
```

## Syntax

**Sources**

- `@path/to/file.txt` — file
- `@path/` — directory tree
- `@path/**/*` — glob respecting `.gitignore`, `@./*`/`@C:/*` no ignore
- `@[file name with spaces.txt]` — path with special characters and spaces
- `@[label](file:///abs/path#L1-10)`, `@[label](relative/path.ts)`, `file:///path/to/file.ts#L10-20` — Markdown links and File URIs
- `` !`ls -la` `` — shell command
- `@:clipboard` — clipboard
- `\@path`, `` \!`cmd` `` — escaping

**Line Slices**

- `@file.ts:15` — single line
- `@file.ts:10-50`, `@file.ts#L10-L50` — line range
- `@file.ts:15-`, `@file.ts:-15` — open-ended slice

**Modifiers and Modes**

- `@##comment`, `@##[multiline or spaced comment]` — comments (stripped with surrounding whitespace)
- `@@file.txt`, `` !!`cmd` `` — `Raw`: string-interpolated without wrapper
- `@=file.txt` — `Direct`: without recursion (no `` !=`cmd` ``)
- `@@=file.txt` — `Raw + Direct`
- Aggressive mode (`-a`) — recognizing file paths without special prefix characters
- Ghost mode (`-g`) — preserving expansion hierarchy while replacing file payloads with stats (line/char count)

## Expansion Semantics

- **Positioning**: a standalone token on a line expands as an in-place block; a token inside a line is hoisted above, leaving `` `file.txt` `` or `` `ls -la` `` in the text (`Raw` tokens always interpolate directly into the line). Inside an expanded file, nested blocks are placed right after their parent so the parent stays faithful to its source.
- **Code Ignoring**: Markdown code blocks (`` ` ``, `~~~`) are skipped with nesting awareness.
- **Recursion**: enabled for prose/markup files; source code files (e.g. `.ts`) and shell command output are expanded without recursion. Depth is bounded (`--depth`) and cycles are cut.
- **Path Resolution**: priority is given to the current file's directory → `cwd`:

```bash
mkdir -p ~/dir
echo '@@index.txt' > ~/dir/inside.txt
echo 'hello !!`pwd`' > ~/dir/index.txt
echo 'world !!`pwd`' > ~/index.txt

cd; echo @@dir/inside.txt | uncat # hello ~
```

- **Deduplication (Two-Pass Canonical Widening)**:
  - merging overlaps: `@file.ts:1-50 @file.ts:30-80` → single wrapped file `1-80` + attestation reference for second
  - replacing subsumed ranges with an attestation reference: `@file.ts:-100\n@file.ts:30-80`
  - accounting for already expanded blocks in the input
- **Shell Environment**: child subshell in parent `cwd`, timeout (`--timeout`), metadata recording (execution time, `stderr`, exit code, modified `cwd`); `--no-shell` disables execution.
- **Quotas and Slicing** (all limits are configurable):
  - **Single-source limit (~350 KB, `--source-limit`)**: middle truncation of an individual file's own payload (excluding recursive children) with a hidden char count indicator
  - **Output shard limit (~350 KB, `--shard-limit`)**: splits final result into `name_{01,02,...}.ext` files when writing to disk
  - **Total output limit (~2 MB, `--total-limit`)**: cap on the entire expanded output
- **Execution**: asynchronous parallel pipeline; ordered side effects (shell) run sequentially.

## Output Format

Every expanded source is wrapped in an element named after its kind, which agents parse reliably and which `uncat` reads back on later runs:

```xml
<file path="src/a.ts" lines="10-50">
…
</file>

<shell cmd="ls -la" exit="0" ms="4">
…
</shell>

<file path="src/a.ts" lines="30-40" ref="above" />
```

## CLI and HUD

```bash
uncat file.txt                # → file_.txt
uncat file.txt file-uncat.txt # → file-uncat.txt
uncat huge.log                # → huge_{01,02,...}.log (sliced by 350 KB)
echo @file.txt | uncat        # → stdout
```

**Interface**

- Full feature parity between CLI and API
- Output modes (`--mode`): HUD (for users), raw (`stdin`/`stdout` pipe), JSON (for AI agents) — chosen automatically from the terminal and agent environment
- Non-piped output provides meta information like total size, total line/char count, from-to line/char positions of every located block
- Actionable errors with fuzzy path suggestions

**HUD**

- Sci-fi minimalism, Unicode, terminal size adaptation
- Graphics instead of flickering digits, all parameters represented in distinct visual ways
- In real time: expansion tree, part completion percentage, elapsed/final time, errors, volume, and slicing

## API

```ts
import { expand, run, uncat } from 'uncat'

const text = await expand('Summarize @README.md', { aggressive: true })
const outcome = await uncat({ input: 'prompt.md', settings: { ghost: true } })
const effect = run({ text: '@src/', settings: { depth: 2 } }) // Effect<Outcome, Fault>
```

Settings use the same names as the CLI flags (camel-cased), so every flag is available to the API.

## License

MIT

<!--
Black Box

You are not permitted to include package own source code in this file.
-->
