/*
 * Tag envelope format for expanded payloads: wraps each source in an element
 * named after its kind, renders attestation references, and reads the same
 * format back to mask, attest and locate blocks already present in a text.
 */
import { resolve } from 'node:path'
import { Effect } from 'effect'
import * as mr from 'multi-integer-range'
import { Ambient } from '../kernel/index.ts'
import { Lines } from '../program/engine.ts'
import { Attestation, Chunk, Position, Source, identityOf } from '../program/model.ts'
import { Feature, defineFeature, whole } from '../program/program.ts'

const OPEN = /^<([a-z][\w-]*)((?:[ \t]+[\w-]+="[^"]*")*)[ \t]*(\/?)>[ \t]*$/gm

const ATTRIBUTE = /([\w-]+)="([^"]*)"/g

const escape = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('\n', '&#10;')

const unescape = (text: string): string =>
  text.replaceAll('&#10;', '\n').replaceAll('&lt;', '<').replaceAll('&quot;', '"').replaceAll('&amp;', '&')

class Block {
  readonly tag: string
  readonly attrs: ReadonlyMap<string, string>
  readonly start: number
  readonly end: number
  readonly complete: boolean
  constructor(tag: string, attrs: ReadonlyMap<string, string>, start: number, end: number, complete: boolean) {
    this.tag = tag
    this.attrs = attrs
    this.start = start
    this.end = end
    this.complete = complete
  }
}

const blocks = (text: string): ReadonlyArray<Block> => {
  const found: Array<Block> = []
  let cursor = 0
  for (const match of text.matchAll(OPEN)) {
    if (match.index < cursor) continue
    const [matched, tag = '', rawAttrs = '', closing = ''] = match
    if (rawAttrs === '') continue
    const attrs = new Map(
      [...rawAttrs.matchAll(ATTRIBUTE)].map(([, key = '', value = '']) => [key, unescape(value)] as const),
    )
    if (closing === '/') {
      found.push(new Block(tag, attrs, match.index, match.index + matched.length, false))
      cursor = match.index + matched.length
      continue
    }
    const terminator = new RegExp(`^</${tag}>[ \\t]*$`, 'gm')
    terminator.lastIndex = match.index + matched.length
    const close = terminator.exec(text)
    if (close === null) continue
    found.push(new Block(tag, attrs, match.index, close.index + close[0].length, true))
    cursor = close.index + close[0].length
  }
  return found
}

const lineAttr = (source: Source): ReadonlyArray<readonly [string, string]> => {
  const lines = new Lines(source.text)
  return lines.covers(source.extent) ? [] : [['lines', mr.stringify(lines.clip(source.extent))]]
}

const open = (tag: string, attrs: ReadonlyArray<readonly [string, string]>): string =>
  `<${tag}${attrs.map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}`

const identity = (root: string, block: Block): string | undefined => {
  const path = block.attrs.get('path')
  return path === undefined ? undefined : identityOf(block.tag, resolve(root, path.replace(/\/$/, '')))
}

const position = (lines: Lines, offset: number): Position => {
  const line = lines.lineOf(offset)
  return new Position({ line, column: offset - lines.start(line) + 1 })
}

export const feature: Feature = defineFeature({
  name: 'envelope',
  refine: (_, base) => ({
    envelope: (source, payload) => {
      const attrs = [...source.attrs, ...lineAttr(source), ...payload.attrs]
      const nested = attrs.filter(([, value]) => value.includes('\n'))
      const parts = [
        payload.body.replace(/\n$/, ''),
        ...nested.map(([key, value]) => `<${key}>\n${value.replace(/\n$/, '')}\n</${key}>`),
      ].filter((part) => part !== '')
      const head = open(
        source.tag,
        attrs.filter(([, value]) => !value.includes('\n')),
      )
      if (parts.length === 0 && payload.attrs.length > 0) return `${head} />`
      return `${head}>\n${parts.map((part) => `${part}\n`).join('')}</${source.tag}>`
    },
    reference: (source) =>
      `${open(source.tag, [...source.attrs.filter(([key]) => key === 'path'), ...lineAttr(source), ['ref', 'above']])} />`,
    mask: (text) =>
      Effect.map(base.mask(text), (masked) =>
        mr.append(masked, mr.normalize(blocks(text).map((block) => [block.start, block.end - 1] as const))),
      ),
    attest: (text) =>
      Effect.gen(function* () {
        const frame = yield* Ambient.Current
        const inherited = yield* base.attest(text)
        const found = blocks(text).flatMap((block) => {
          const id = identity(frame.root, block)
          if (!block.complete || id === undefined || block.attrs.has('ref')) return []
          const lines = block.attrs.get('lines')
          return [
            new Attestation({
              identity: id,
              extent: lines === undefined ? whole : mr.parse(lines, { parseUnbounded: true }),
            }),
          ]
        })
        return [...inherited, ...found]
      }),
    chunks: (text) => {
      const lines = new Lines(text)
      return [
        ...base.chunks(text),
        ...blocks(text).map(
          (block) =>
            new Chunk({
              tag: block.tag,
              label: block.attrs.get('path') ?? block.attrs.get('cmd') ?? block.tag,
              identity: block.attrs.has('ref') ? '' : (identity('', block) ?? ''),
              file: '',
              from: position(lines, block.start),
              to: position(lines, Math.max(block.start, block.end - 1)),
            }),
        ),
      ]
    },
  }),
})
