/*
 * Hybrid initial-final expansion engine that reifies a text into annotated
 * nodes, lowers them speculatively into a tree of loaded sources, and then
 * renders that tree purely so global canonicalization never waits on I/O.
 */
import { Cause, Data, Effect } from 'effect'
import { MagicString } from 'magic-string'
import * as mr from 'multi-integer-range'
import { Ahead, Ambient, Schedule } from '../kernel/index.ts'
import { Compiled, compile, scan } from './grammar.ts'
import {
  Attestation,
  Branch,
  Diagnostic,
  Expanded,
  Expansion,
  Fault,
  Meta,
  Occurrence,
  Replacement,
  Signal,
  Source,
  Span,
} from './model.ts'
import { Program, verdict, whole } from './program.ts'

export { Branch, Expanded, Expansion }

export class Lines {
  readonly text: string
  readonly starts: ReadonlyArray<number>
  constructor(text: string) {
    const starts = [0]
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1)
    this.text = text
    this.starts = starts
  }
  get count(): number {
    return this.starts.length
  }
  get size(): number {
    return this.text.endsWith('\n') ? this.starts.length - 1 : this.text === '' ? 0 : this.starts.length
  }
  covers(window: mr.MIR): boolean {
    return this.size === 0 || mr.has(window, [[1, this.size]])
  }
  lineOf(offset: number): number {
    let low = 0
    let high = this.starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((this.starts[middle] ?? 0) <= offset) low = middle
      else high = middle - 1
    }
    return low + 1
  }
  start(line: number): number {
    return this.starts[line - 1] ?? this.text.length
  }
  end(line: number): number {
    const next = this.starts[line]
    return next === undefined ? this.text.length : next - 1
  }
  clip(window: mr.MIR): mr.MIR {
    return this.size === 0 ? [] : mr.intersect(window, [[1, this.size]])
  }
  chars(window: mr.MIR): mr.MIR {
    if (this.covers(window)) return this.text.length === 0 ? [] : [[0, this.text.length - 1]]
    return mr.normalize(
      this.clip(window).map(([from, to]): readonly [number, number] => [
        this.start(from),
        Math.max(this.start(from), Math.min(this.text.length - 1, (this.starts[to] ?? this.text.length) - 1)),
      ]),
    )
  }
  slice(window: mr.MIR, cut: (from: number, to: number) => string): string {
    if (this.covers(window)) return cut(0, this.text.length)
    return this.clip(window)
      .map(([from, to]) => cut(this.start(from), this.end(to)))
      .join('\n…\n')
  }
}

const grammars = new WeakMap<Program, ReadonlyArray<Compiled>>()

const grammarOf = (program: Program): ReadonlyArray<Compiled> => {
  const cached = grammars.get(program)
  if (cached !== undefined) return cached
  const sigils = [...new Set(program.bodies.map((body) => body.sigil))]
  const compiled = program.bodies.map((body) => compile(body, program.fragments, sigils))
  grammars.set(program, compiled)
  return compiled
}

class Candidate extends Data.Class<{
  readonly feature: string
  readonly span: Span
  readonly payload: unknown
  readonly marks: Readonly<Record<string, string>>
  readonly label: string
  readonly priority: number
  readonly tentative: boolean
}> {}

const width = (span: Span): number => span.end - span.start

const select = (candidates: ReadonlyArray<Candidate>): ReadonlyArray<Candidate> => {
  const ordered = candidates.toSorted(
    (a, b) => a.span.start - b.span.start || width(b.span) - width(a.span) || b.priority - a.priority,
  )
  const chosen: Array<Candidate> = []
  let cursor = -1
  for (const candidate of ordered) {
    if (candidate.span.start < cursor) continue
    chosen.push(candidate)
    cursor = candidate.span.end
  }
  return chosen
}

const blank = (text: string): boolean => text.trim() === ''

export const recognize: (
  program: Program,
  text: string,
  window: mr.MIR,
) => Effect.Effect<ReadonlyArray<Ahead.Annotated<Meta, unknown>>> = Effect.fnUntraced(function* (
  program: Program,
  text: string,
  window: mr.MIR,
): Effect.fn.Return<ReadonlyArray<Ahead.Annotated<Meta, unknown>>> {
  const frame = yield* Ambient.Current
  const lines = new Lines(text)
  const masked = yield* program.mask(text)
  const allowed = lines.chars(window)
  const candidates: Array<Candidate> = []
  for (const compiled of grammarOf(program)) {
    for (const parsed of scan(compiled, text)) {
      candidates.push(new Candidate({ ...parsed, priority: compiled.body.priority, tentative: false }))
    }
  }
  for (const scanner of program.scanners) {
    for (const hit of yield* scanner.scan(text)) {
      candidates.push(
        new Candidate({
          feature: scanner.feature,
          span: hit.span,
          payload: hit.payload,
          marks: {},
          label: hit.label,
          priority: scanner.priority,
          tentative: scanner.tentative,
        }),
      )
    }
  }
  const live = candidates.filter(
    ({ span }) =>
      span.end > span.start &&
      !mr.has(masked, [[span.start, span.start]]) &&
      mr.has(allowed, [[span.start, span.end - 1]]),
  )
  return select(live).map((candidate) => {
    const first = lines.lineOf(candidate.span.start)
    const last = lines.lineOf(candidate.span.end - 1)
    const standalone =
      blank(text.slice(lines.start(first), candidate.span.start)) &&
      blank(text.slice(candidate.span.end, lines.end(last)))
    return Ahead.lift(
      new Meta({
        id: `${frame.correlationId}/${candidate.span.start}`,
        feature: candidate.feature,
        span: candidate.span,
        line: first,
        placement: standalone ? 'standalone' : 'inline',
        marks: candidate.marks,
        label: candidate.label,
        text: text.slice(candidate.span.start, candidate.span.end),
        tentative: candidate.tentative,
      }),
    )(candidate.payload)
  })
})

const asFault = (cause: Cause.Cause<Fault>): Fault => {
  const error = Cause.squash(cause)
  return error instanceof Fault
    ? error
    : new Fault({
        code: 'defect',
        message: error instanceof Error ? error.message : String(error),
        subject: '',
        hint: '',
      })
}

const signal = (program: Program, fields: ConstructorParameters<typeof Signal>[0]): Effect.Effect<void> =>
  program.observe(new Signal(fields))

const expandNode = Effect.fnUntraced(function* (
  program: Program,
  node: Ahead.Annotated<Meta, unknown>,
): Effect.fn.Return<Expanded> {
  const frame = yield* Ambient.Current
  const literal = program.literal(node)
  const settle = (fields: Partial<ConstructorParameters<typeof Expanded>[0]>): Expanded =>
    new Expanded({
      node,
      literal: undefined,
      branches: [],
      fault: undefined,
      enveloped: false,
      depth: frame.depth,
      ...fields,
    })
  if (literal !== undefined) return settle({ literal })
  const { id, label, tentative } = node.meta
  if (!tentative)
    yield* signal(program, {
      kind: 'open',
      id,
      parent: frame.correlationId,
      label,
      depth: frame.depth,
      bytes: 0,
      detail: '',
    })
  const enveloped = verdict(
    program.enveloping.map((policy) => policy(node)),
    true,
  )
  const settleBranch = Effect.fnUntraced(function* (source: Source, index: number) {
    const lines = new Lines(source.text)
    const scoped = new Source({ ...source, extent: mr.intersect(source.extent, program.extent(node, lines.size)) })
    const branchId = `${id}#${index}`
    if (lines.size > 0 && lines.clip(scoped.extent).length === 0) {
      return yield* new Fault({
        code: 'empty-extent',
        message: `${scoped.label} has no lines in the requested range`,
        subject: scoped.label,
        hint: `it has ${lines.size} lines`,
      })
    }
    const votes = yield* Effect.forEach(program.recursion, (policy) => policy(node, scoped))
    const children = verdict(votes, false)
      ? yield* expand(program, scoped.text, scoped.extent).pipe(
          Ambient.descend({ correlationId: branchId, scope: scoped.scope, identity: scoped.identity }),
        )
      : undefined
    return new Branch({ id: branchId, source: scoped, children })
  })
  const outcome = yield* program.interpret(node).pipe(
    Effect.flatMap((sources) => Effect.forEach(sources, settleBranch, { concurrency: 'unbounded' })),
    Effect.map((branches) => ({ branches, fault: undefined })),
    Effect.catchCause((cause) => Effect.succeed({ branches: [], fault: asFault(cause) })),
  )
  if (outcome.fault !== undefined) {
    if (tentative) return settle({ fault: outcome.fault })
    const fault = yield* program.diagnose(outcome.fault)
    yield* signal(program, {
      kind: 'fault',
      id,
      parent: frame.correlationId,
      label,
      depth: frame.depth,
      bytes: 0,
      detail: fault.message,
    })
    return settle({ fault })
  }
  const { branches } = outcome
  const bytes = branches.reduce((total, branch) => total + branch.source.text.length, 0)
  yield* signal(program, {
    kind: 'close',
    id,
    parent: frame.correlationId,
    label,
    depth: frame.depth,
    bytes,
    detail: '',
  })
  return settle({ branches, enveloped })
})

export const expand = (program: Program, text: string, window: mr.MIR = whole): Effect.Effect<Expansion> =>
  Effect.gen(function* () {
    const nodes = yield* recognize(program, text, window)
    const expanded = yield* Schedule.lower(
      nodes,
      (node) => program.traits[node.meta.feature] ?? 'parallel',
      (node) => expandNode(program, node),
    )
    return new Expansion({ text, window, nodes: expanded })
  })

export const visit = (expansion: Expansion, f: (expanded: Expanded, branch: Branch | undefined) => void): void => {
  for (const expanded of expansion.nodes) {
    if (expanded.branches.length === 0) f(expanded, undefined)
    for (const branch of expanded.branches) {
      f(expanded, branch)
      if (branch.children !== undefined) visit(branch.children, f)
    }
  }
}

export const diagnostics = (expansion: Expansion): ReadonlyArray<Diagnostic> => {
  const found: Array<Diagnostic> = []
  visit(expansion, (expanded, branch) => {
    const fault = expanded.fault
    if (branch !== undefined || fault === undefined || expanded.node.meta.tentative) return
    found.push(
      new Diagnostic({
        code: fault.code,
        message: fault.message,
        subject: fault.subject,
        hint: fault.hint,
        depth: expanded.depth,
      }),
    )
  })
  return found
}

const replace = (code: MagicString, start: number, end: number, text: string): void => {
  if (start === end) {
    if (text !== '') code.appendRight(start, text)
  } else if (text === '') code.remove(start, end)
  else code.update(start, end, text)
}

export const collapse = (code: MagicString, lines: Lines, expanded: Expanded, replacement: Replacement): void => {
  const { span, placement } = expanded.node.meta
  const text = lines.text
  if (!replacement.collapse) return replace(code, span.start, span.end, replacement.text)
  if (placement === 'standalone' && replacement.text === '') {
    const from = lines.start(lines.lineOf(span.start))
    const to = lines.end(lines.lineOf(span.end - 1))
    if (to < text.length) return replace(code, from, to + 1, '')
    return replace(code, from > 0 ? from - 1 : from, to, '')
  }
  let start = span.start
  let end = span.end
  while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++
  if (end === span.end) while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--
  replace(code, start, end, replacement.text)
}

const windowed = (code: MagicString, lines: Lines, window: mr.MIR): string => {
  if (lines.covers(window)) return code.toString()
  const ranges = lines.clip(window)
  if (ranges.length === 0) return ''
  const copy = code.clone()
  let cursor = 0
  for (const [from, to] of ranges) {
    const start = lines.start(from)
    if (start > cursor) copy.remove(cursor, start)
    if (cursor > 0) copy.prependRight(start, '\n…\n')
    cursor = lines.end(to)
  }
  if (cursor < lines.text.length) copy.remove(cursor, lines.text.length)
  return copy.toString()
}

class Block extends Data.Class<{ readonly text: string; readonly reference: boolean }> {}

class Rendered extends Data.Class<{ readonly text: string; readonly detached: ReadonlyArray<string> }> {}

export const merge = (group: ReadonlyArray<Branch>, text: string, window: mr.MIR): Expansion | undefined => {
  const seen = new Map<number, Expanded>()
  for (const branch of group) {
    for (const expanded of branch.children?.nodes ?? []) {
      if (!seen.has(expanded.node.meta.span.start)) seen.set(expanded.node.meta.span.start, expanded)
    }
  }
  if (group.every((branch) => branch.children === undefined)) return undefined
  const nodes = [...seen.values()].toSorted((a, b) => a.node.meta.span.start - b.node.meta.span.start)
  return new Expansion({ text, window, nodes })
}

export const render = (
  program: Program,
  root: Expansion,
  attested: ReadonlyArray<Attestation>,
): Effect.Effect<string> => {
  const occurrences: Array<Occurrence> = []
  const members = new Map<string, Array<Branch>>()
  visit(root, (expanded, branch) => {
    if (branch === undefined || !expanded.enveloped || branch.source.identity === '') return
    occurrences.push(new Occurrence({ identity: branch.source.identity, extent: branch.source.extent }))
    members.set(branch.source.identity, [...(members.get(branch.source.identity) ?? []), branch])
  })
  const plan = program.plan(occurrences, attested)
  const claimed = new Set<string>()

  const body = (
    source: Source,
    children: Expansion | undefined,
    mode: 'inline' | 'detached',
  ): Effect.Effect<Rendered> =>
    children === undefined
      ? Effect.succeed(
          new Rendered({
            text: new Lines(source.text).slice(source.extent, (a, b) => source.text.slice(a, b)),
            detached: [],
          }),
        )
      : expansionOf(new Expansion({ ...children, window: source.extent }), mode)

  const block = Effect.fnUntraced(function* (source: Source, children: Expansion | undefined) {
    const inner = yield* body(source, children, 'detached')
    const payload = yield* program.payload(source, inner.text)
    return [program.envelope(source, payload), ...inner.detached].join('\n\n')
  })

  const canonical = (branch: Branch): Effect.Effect<Block> => {
    const { source } = branch
    const planned = source.identity === '' ? undefined : plan.get(source.identity)
    if (planned === undefined)
      return Effect.map(block(source, branch.children), (text) => new Block({ text, reference: false }))
    if (claimed.has(source.identity) || planned.length === 0) {
      claimed.add(source.identity)
      return Effect.succeed(new Block({ text: program.reference(source), reference: true }))
    }
    claimed.add(source.identity)
    const group = members.get(source.identity) ?? [branch]
    return Effect.map(
      block(new Source({ ...source, extent: planned }), merge(group, source.text, planned)),
      (text) => new Block({ text, reference: false }),
    )
  }

  const interpolate = Effect.fnUntraced(function* (branch: Branch, mode: 'inline' | 'detached') {
    const inner = yield* body(branch.source, branch.children, mode)
    const payload = yield* program.payload(branch.source, inner.text)
    const text = payload.body.replace(/\n$/, '')
    return new Rendered({ text, detached: inner.detached })
  })

  function expansionOf(expansion: Expansion, mode: 'inline' | 'detached'): Effect.Effect<Rendered> {
    return Effect.gen(function* () {
      const lines = new Lines(expansion.text)
      const code = new MagicString(expansion.text)
      const detached: Array<string> = []
      for (const expanded of expansion.nodes) {
        const { span, placement, label } = expanded.node.meta
        if (expanded.literal !== undefined) {
          collapse(code, lines, expanded, expanded.literal)
          continue
        }
        if (expanded.fault !== undefined) continue
        if (!expanded.enveloped) {
          const parts = yield* Effect.forEach(expanded.branches, (branch) => interpolate(branch, mode))
          replace(code, span.start, span.end, parts.map((part) => part.text).join('\n'))
          detached.push(...parts.flatMap((part) => part.detached))
          continue
        }
        const blocks = yield* Effect.forEach(expanded.branches, canonical)
        const fresh = blocks.filter((item) => !item.reference).map((item) => item.text)
        if (mode === 'detached') {
          replace(code, span.start, span.end, label)
          detached.push(...fresh)
        } else if (placement === 'standalone') {
          replace(
            code,
            lines.start(lines.lineOf(span.start)),
            lines.end(lines.lineOf(span.end - 1)),
            blocks.map((item) => item.text).join('\n\n'),
          )
        } else {
          replace(code, span.start, span.end, label)
          if (fresh.length > 0) code.appendRight(lines.start(lines.lineOf(span.start)), `${fresh.join('\n\n')}\n\n`)
        }
      }
      return new Rendered({ text: windowed(code, lines, expansion.window), detached })
    })
  }

  return Effect.flatMap(program.tree(root, attested), (custom) =>
    custom === undefined
      ? Effect.map(expansionOf(root, 'inline'), (rendered) => rendered.text)
      : Effect.succeed(custom),
  )
}
