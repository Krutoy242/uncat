/*
 * Human presenter that draws a live heads-up display sized to the terminal,
 * rendering progress and volume while work runs and markdown when finished.
 */
import { relative } from 'node:path'
import { styleText } from 'node:util'
import { intro, log, outro } from '@clack/prompts'
import { Context, Effect, Layer } from 'effect'
import { HookableCore } from 'hookable'
import { init, renderToAnsi } from 'md4x/standalone'
import { hasTTY, isCI } from 'std-env'
import { Ambient } from '../kernel/index.ts'
import { Outcome, Presenter, Signal } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const NAME = 'hud'

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

const SPINNER = ['◐', '◓', '◑', '◒']

const GLYPH = { running: '◌', done: '◆', fault: '✖' } as const

const hasColor = (): boolean => !('NO_COLOR' in process.env) && process.env['NODE_DISABLE_COLORS'] !== '1'

const paint = (format: Parameters<typeof styleText>[0], text: string): string =>
  hasColor() ? styleText(format, text, { validateStream: false }) : text

const meter = (ratio: number, width: number): string => {
  const units = Math.round(Math.max(0, Math.min(1, ratio)) * width * 8)
  const full = Math.floor(units / 8)
  return `${'█'.repeat(full)}${EIGHTHS[units % 8] ?? ''}`.padEnd(width, ' ')
}

const volume = (bytes: number): number => Math.min(1, Math.log10(bytes + 1) / 6)

const segments = (ratio: number, width: number, styled = true): string => {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width)
  const full = '█'.repeat(filled)
  const empty = '░'.repeat(width - filled)
  return styled ? `${paint('green', full)}${paint('dim', empty)}` : `${full}${empty}`
}

const fit = (text: string, width: number): string =>
  text.length <= width ? text.padEnd(width, ' ') : `${text.slice(0, Math.max(0, width - 1))}…`

const size = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 ** 2).toFixed(2)} MB`

class Row {
  readonly id: string
  readonly parent: string
  readonly label: string
  readonly depth: number
  state: 'running' | 'done' | 'fault' = 'running'
  bytes = 0
  detail = ''
  constructor(signal: Signal) {
    this.id = signal.id
    this.parent = signal.parent.includes('#') ? signal.parent.slice(0, signal.parent.lastIndexOf('#')) : ''
    this.label = signal.label
    this.depth = signal.depth
  }
}

class Board {
  readonly rows = new Map<string, Row>()
  readonly shards: Array<string> = []
  readonly notes: Array<string> = []
  started = performance.now()
  finished = 0
  ticks = 0
  apply(signal: Signal): void {
    const row = this.rows.get(signal.id)
    if (signal.kind === 'begin') this.started = performance.now()
    else if (signal.kind === 'open') this.rows.set(signal.id, new Row(signal))
    else if (signal.kind === 'write') this.shards.push(signal.label)
    else if (signal.kind === 'end') this.finished = performance.now()
    else if (signal.kind === 'fault' && row === undefined) this.notes.push(signal.detail)
    if (row === undefined) return
    if (signal.kind === 'close') row.state = 'done'
    if (signal.kind === 'fault') row.state = 'fault'
    row.bytes = signal.bytes
    row.detail = signal.detail
  }
  ordered(): ReadonlyArray<readonly [Row, string]> {
    const children = new Map<string, Array<Row>>()
    for (const row of this.rows.values()) children.set(row.parent, [...(children.get(row.parent) ?? []), row])
    const walk = (parent: string, indent: string): ReadonlyArray<readonly [Row, string]> =>
      (children.get(parent) ?? []).flatMap((row, index, siblings) => {
        const last = index === siblings.length - 1
        const branch = parent === '' ? '' : `${indent}${last ? '└─' : '├─'}`
        return [[row, branch] as const, ...walk(row.id, parent === '' ? '' : `${indent}${last ? '  ' : '│ '}`)]
      })
    return walk('', '')
  }
  lines(columns: number, height: number): ReadonlyArray<string> {
    const rows = this.ordered()
    const settled = rows.filter(([row]) => row.state !== 'running').length
    const faults = rows.filter(([row]) => row.state === 'fault').length + this.notes.length
    const elapsed = (this.finished || performance.now()) - this.started
    const bytes = rows.reduce((total, [row]) => total + row.bytes, 0)
    const spin = this.finished === 0 ? (SPINNER[this.ticks++ % SPINNER.length] ?? '') : '◆'
    const progress = rows.length === 0 ? (this.finished === 0 ? 0 : 1) : settled / rows.length
    const width = Math.max(40, Math.min(56, columns - 6))
    const segWidth = 10
    const ruleLen = Math.max(4, width - 8 - segWidth)
    const topBar = `${paint('cyan', spin)} ${paint('bold', 'uncat')} ${paint('dim', '━'.repeat(ruleLen))} ${segments(progress, segWidth)}`
    const labelWidth = Math.max(12, width - 18)
    const body = rows.slice(-Math.max(3, height - 4)).map(([row, branch]) => {
      const glyph =
        row.state === 'done'
          ? paint('green', GLYPH.done)
          : row.state === 'fault'
            ? paint('red', GLYPH.fault)
            : paint('yellow', GLYPH.running)
      const connector = branch === '' ? '' : paint('dim', branch)
      const maxLabelLen = Math.max(6, labelWidth - branch.length - 2)
      const labelText = fit(row.label, maxLabelLen).padEnd(maxLabelLen, ' ')
      const styledLabel = row.state === 'running' ? paint('bold', labelText) : labelText
      const tail =
        row.state === 'fault'
          ? paint('red', fit(row.detail, 12))
          : `▕${paint('cyan', meter(volume(row.bytes), 8))}▏`
      return `  ${connector}${glyph} ${styledLabel} ${tail}`
    })
    const dots = '·'.repeat(Math.min(8, Math.ceil(elapsed / 250))).padEnd(8, ' ')
    const footerParts = [
      `  ${paint('yellow', `◷ ${dots}`)}`,
      `vol ▕${paint('cyan', meter(volume(bytes), 8))}▏`,
      this.shards.length > 0 ? `✂ ${paint('magenta', '▌'.repeat(Math.min(this.shards.length, 6)))}` : '',
      faults > 0 ? paint('red', '✖'.repeat(Math.min(faults, 6))) : '',
    ].filter((part) => part !== '')
    const footer = footerParts.join(' ')
    return [topBar, ...body, footer]
  }
}

const makeHudPort = () => {
  const board = new Board()
  const bus = new HookableCore<{ signal: (signal: Signal) => void }>()
  const stream = process.stderr
  let drawn = 0
  let last = -Infinity
  let timer: NodeJS.Timeout | undefined
  const erase = (): void => {
    if (drawn > 0) stream.write(`\u001b[${drawn}F\u001b[J`)
    drawn = 0
  }
  const draw = (force: boolean): void => {
    const now = performance.now()
    if (!stream.isTTY || (!force && now - last < 60)) return
    last = now
    const lines = board.lines(stream.columns || 80, stream.rows || 24)
    erase()
    stream.write(`${lines.join('\n')}\n`)
    drawn = lines.length
  }
  const stopTimer = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  bus.hook('signal', (signal) => {
    if (signal.kind === 'begin') {
      board.rows.clear()
      board.shards.length = 0
      board.notes.length = 0
      board.finished = 0
      board.ticks = 0
      stopTimer()
      if (stream.isTTY) {
        timer = setInterval(() => {
          draw(true)
        }, 80)
        timer.unref()
      }
    }
    board.apply(signal)
    if (signal.kind === 'end') {
      stopTimer()
      draw(true)
    } else if (signal.kind === 'begin' || signal.kind === 'open') {
      draw(true)
    } else {
      draw(false)
    }
  })
  return {
    push: (signal: Signal): void => void bus.callHook('signal', signal),
    settle: (): ReadonlyArray<string> => {
      stopTimer()
      erase()
      return board.lines(stream.columns || 80, Number.MAX_SAFE_INTEGER)
    },
  }
}

let hudService: ReturnType<typeof makeHudPort> | undefined

class HudPort extends Context.Service<HudPort>()('uncat/hud/HudPort', {
  make: Effect.sync(() => (hudService ??= makeHudPort())),
}) {
  static readonly layer: Layer.Layer<HudPort> = Layer.unwrap(Effect.sync(() => Layer.effect(HudPort, HudPort.make)))
}

let markdownReady: Promise<void> | undefined

class MarkdownPort extends Context.Service<MarkdownPort>()('uncat/hud/MarkdownPort', {
  make: Effect.sync(() => ({
    render: (markdown: string): Effect.Effect<string> =>
      Effect.promise(async () => {
        await (markdownReady ??= init())
        return renderToAnsi(markdown)
      }),
  })),
}) {
  static readonly layer: Layer.Layer<MarkdownPort> = Layer.unwrap(
    Effect.sync(() => Layer.effect(MarkdownPort, MarkdownPort.make)),
  )
}

const summary = (outcome: Outcome): string => {
  const { report } = outcome
  const headline = `**${report.sources}** sources · **${size(report.bytes)}** · **${report.lines}** lines · **${(report.elapsedMs / 1000).toFixed(2)} s**`
  const outputs = report.outputs.map(
    (output) =>
      `| \`${(relative(process.cwd(), output.path) || output.path).replaceAll('\\', '/')}\` | ${segments(output.chars / Math.max(1, report.chars), 8, false)} ${size(output.bytes)} | ${output.lines} |`,
  )
  const table = outputs.length === 0 ? [] : ['', '| output | volume | lines |', '| --- | --- | --- |', ...outputs]
  const chunks =
    report.chunks.length === 0
      ? []
      : ['', `**${report.chunks.length}** located blocks · first at line ${report.chunks[0]?.from.line ?? 1}`]
  return [headline, ...table, ...chunks].join('\n')
}

export const feature: Feature = defineFeature({
  name: NAME,
  refine: (_, base) => ({
    layers: [...base.layers, HudPort.layer, MarkdownPort.layer],
    observe: (signal) =>
      Effect.gen(function* () {
        yield* base.observe(signal)
        const frame = yield* Ambient.Current
        if (frame.settings['mode'] !== NAME) return
        const port = yield* HudPort
        port.push(signal)
      }).pipe(Effect.provide(HudPort.layer)),
    presenters: [
      ...base.presenters,
      new Presenter({
        name: NAME,
        auto: () => hasTTY && (process.stderr.isTTY ?? false) && !isCI,
        present: (outcome) =>
          Effect.gen(function* () {
            const hud = yield* HudPort
            const markdown = yield* MarkdownPort
            const rendered = yield* markdown.render(summary(outcome))
            const tree = hud.settle()
            if (outcome.toStdout) process.stdout.write(outcome.text.endsWith('\n') ? outcome.text : `${outcome.text}\n`)
            const output = outcome.toStdout ? process.stderr : process.stdout
            intro(paint(['bgCyan', 'black', 'bold'], ' uncat '), { output })
            log.message(tree.join('\n'), { output, symbol: paint('cyan', '◇') })
            log.message(rendered.trimEnd(), { output })
            for (const diagnostic of outcome.report.diagnostics) {
              log.error(`${diagnostic.message}${diagnostic.hint === '' ? '' : `\n${diagnostic.hint}`}`, { output })
            }
            outro(
              outcome.report.diagnostics.length === 0
                ? paint('green', '◆ done')
                : paint('red', `✖ ${outcome.report.diagnostics.length} unresolved`),
              { output },
            )
          }).pipe(Effect.provide(HudPort.layer), Effect.provide(MarkdownPort.layer)),
      }),
    ],
  }),
})
