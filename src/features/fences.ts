/*
 * Markdown code awareness that hides fenced blocks and the interior of inline
 * code spans from recognition, following fence length and character rules so
 * longer outer fences may safely contain shorter inner ones.
 */
import { Effect } from 'effect'
import * as mr from 'multi-integer-range'
import { Feature, defineFeature } from '../program/program.ts'

const OPENER = /^ {0,3}(`{3,}|~{3,})(.*)$/

const fenced = (text: string): ReadonlyArray<readonly [number, number]> => {
  const ranges: Array<readonly [number, number]> = []
  let offset = 0
  let open: { readonly start: number; readonly char: string; readonly size: number } | undefined
  for (const line of text.split('\n')) {
    const end = offset + line.length
    if (open === undefined) {
      const match = OPENER.exec(line)
      const fence = match?.[1]
      if (fence !== undefined && !(fence.startsWith('`') && (match?.[2] ?? '').includes('`'))) {
        open = { start: offset, char: fence.charAt(0), size: fence.length }
      }
    } else {
      const closer = new RegExp(`^ {0,3}${open.char === '`' ? '`' : '~'}{${open.size},}\\s*$`)
      if (closer.test(line)) {
        ranges.push([open.start, end])
        open = undefined
      }
    }
    offset = end + 1
  }
  if (open !== undefined) ranges.push([open.start, Math.max(open.start, text.length - 1)])
  return ranges
}

const INLINE = /(?<!`)(`+)(?!`)((?:(?!\n\n)[\s\S])*?[^`])\1(?!`)/g

const spans = (text: string, hidden: mr.MIR): ReadonlyArray<readonly [number, number]> =>
  text.length === 0
    ? []
    : mr.subtract([[0, text.length - 1]], hidden).flatMap(([from, to]) =>
        [...text.slice(from, to + 1).matchAll(INLINE)].map((match) => {
          const size = (match[1] ?? '').length
          const start = from + match.index
          return [start + size, start + match[0].length - size - 1] as const
        }),
      )

export const feature: Feature = defineFeature({
  name: 'fences',
  refine: (_, base) => ({
    mask: (text) =>
      Effect.map(base.mask(text), (masked) => {
        const hidden = mr.append(masked, mr.normalize(fenced(text)))
        return mr.append(hidden, mr.normalize(spans(text, hidden)))
      }),
  }),
})
