/*
 * Ghost mode that renders the recursive expansion hierarchy as a nested XML
 * tree with tabs, replacing every prose payload chunk with a metadata tag.
 */
import { Effect } from 'effect'
import { MagicString } from 'magic-string'
import * as mr from 'multi-integer-range'
import { Lines, collapse, merge, visit } from '../program/engine.ts'
import { Attestation, Branch, Expansion, Occurrence, Payload, Source, flag } from '../program/model.ts'
import { Feature, Program, defineFeature, whole } from '../program/program.ts'

const ghost = flag({
  key: 'ghost',
  alias: 'g',
  description: 'Keep the hierarchy but replace payloads with their sizes',
})

const indent = (text: string): string =>
  text
    .split('\n')
    .map((line) => (line === '' ? '' : `\t${line}`))
    .join('\n')

const hasActiveNodes = (expansion: Expansion | undefined): boolean =>
  expansion !== undefined &&
  expansion.nodes.some(
    (expanded) => expanded.literal === undefined && expanded.fault === undefined && expanded.branches.length > 0,
  )

const proseOf = (expansion: Expansion): { readonly lines: Lines; readonly code: MagicString } => {
  const lines = new Lines(expansion.text)
  const code = new MagicString(expansion.text)
  for (const expanded of expansion.nodes) {
    if (expanded.literal !== undefined) collapse(code, lines, expanded, expanded.literal)
  }
  return { lines, code }
}

const sliceWindow = (lines: Lines, code: MagicString, window: mr.MIR, from: number, to: number): string => {
  if (from >= to) return ''
  if (lines.covers(window)) return code.slice(from, to)
  return lines
    .clip(window)
    .flatMap(([lineFrom, lineTo]) => {
      const start = Math.max(from, lines.start(lineFrom))
      const end = Math.min(to, lines.end(lineTo))
      return start < end ? [code.slice(start, end)] : []
    })
    .join('\n…\n')
}

const leafText = (source: Source, children: Expansion | undefined): string => {
  if (children === undefined) return new Lines(source.text).slice(source.extent, (a, b) => source.text.slice(a, b))
  const { lines, code } = proseOf(children)
  return sliceWindow(lines, code, source.extent, 0, children.text.length)
}

const renderGhost = (
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

  const textTag = (raw: string): Effect.Effect<ReadonlyArray<string>> => {
    const trimmed = raw.replace(/^\n+|\n+$/g, '')
    if (trimmed.trim() === '') return Effect.succeed([])
    const source = new Source({
      tag: 'text',
      attrs: [],
      identity: '',
      label: 'text',
      scope: '',
      kind: 'txt',
      text: trimmed,
      extent: whole,
    })
    return Effect.map(program.payload(source, trimmed), (payload) => [program.envelope(source, payload)])
  }

  const renderBranch = (branch: Branch, enveloped: boolean): Effect.Effect<ReadonlyArray<string>> =>
    Effect.gen(function* () {
      const { source } = branch
      if (!enveloped) {
        return hasActiveNodes(branch.children) && branch.children !== undefined
          ? yield* itemsOf(new Expansion({ ...branch.children, window: source.extent }))
          : yield* textTag(leafText(source, branch.children))
      }
      const planned = source.identity === '' ? undefined : plan.get(source.identity)
      if (planned !== undefined && (claimed.has(source.identity) || planned.length === 0)) {
        claimed.add(source.identity)
        return [program.reference(source)]
      }
      if (planned !== undefined) claimed.add(source.identity)
      const target = planned === undefined ? source : new Source({ ...source, extent: planned })
      const children =
        planned === undefined ? branch.children : merge(members.get(source.identity) ?? [branch], source.text, planned)
      if (hasActiveNodes(children) && children !== undefined) {
        const nested = yield* itemsOf(new Expansion({ ...children, window: target.extent }))
        return [program.envelope(target, new Payload({ attrs: [], body: indent(nested.join('\n')), hidden: 0 }))]
      }
      const payload = yield* program.payload(target, leafText(target, children))
      return [program.envelope(target, payload)]
    })

  function itemsOf(expansion: Expansion): Effect.Effect<ReadonlyArray<string>> {
    return Effect.gen(function* () {
      const { lines, code } = proseOf(expansion)
      const active = expansion.nodes.filter(
        (expanded) => expanded.literal === undefined && expanded.fault === undefined && expanded.branches.length > 0,
      )
      const out: Array<string> = []
      let cursor = 0
      for (const expanded of active) {
        out.push(...(yield* textTag(sliceWindow(lines, code, expansion.window, cursor, expanded.node.meta.span.start))))
        const branchItems = yield* Effect.forEach(expanded.branches, (branch) =>
          renderBranch(branch, expanded.enveloped),
        )
        out.push(...branchItems.flat())
        cursor = expanded.node.meta.span.end
      }
      out.push(...(yield* textTag(sliceWindow(lines, code, expansion.window, cursor, expansion.text.length))))
      return out
    })
  }

  return Effect.map(itemsOf(root), (items) => items.join('\n'))
}

export const feature: Feature = defineFeature({
  name: 'ghost',
  refine: (self, base) => ({
    settings: [...base.settings, ghost],
    tree: (root, attested) =>
      Effect.flatMap(ghost.read, (on) => (on ? renderGhost(self, root, attested) : base.tree(root, attested))),
    payload: (source, body) =>
      Effect.flatMap(ghost.read, (on) =>
        on
          ? Effect.succeed(
              new Payload({
                attrs: [
                  ['line-count', String(body === '' ? 0 : body.replace(/\n$/, '').split('\n').length)],
                  ['char-count', String(body.length)],
                ],
                body: '',
                hidden: body.length,
              }),
            )
          : base.payload(source, body),
      ),
  }),
})
