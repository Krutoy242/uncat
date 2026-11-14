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

const INLINE = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g

const spans = (text: string, hidden: mr.MIR): ReadonlyArray<readonly [number, number]> =>
  [...text.matchAll(INLINE)]
    .filter((match) => !mr.has(hidden, [[match.index, match.index]]) && !(match[2] ?? '').includes('\n\n'))
    .map((match) => {
      const size = (match[1] ?? '').length
      return [match.index + size, match.index + match[0].length - size - 1] as const
    })

export const feature: Feature = defineFeature({
  name: 'fences',
  refine: (_, base) => ({
    mask: (text) =>
      Effect.map(base.mask(text), (masked) => {
        const blocks = mr.normalize(fenced(text))
        return mr.append(masked, mr.append(blocks, mr.normalize(spans(text, blocks))))
      }),
  }),
})
