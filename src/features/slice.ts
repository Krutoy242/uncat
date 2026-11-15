/*
 * Line-slice suffix for path-like tokens, accepting both colon ranges and
 * anchor-style ranges and narrowing the requested extent of a source, so the
 * rest of the pipeline only ever reasons about abstract line sets.
 */
import { Schema, SchemaGetter } from 'effect'
import * as mr from 'multi-integer-range'
import { Fragment } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const NAME = 'slice'

const PATTERN = String.raw`:\d+(?:-\d*)?|:-\d+|#L\d+(?:-L?\d+)?`

const Bound = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9_999_999 }))

class SliceMark extends Schema.Class<SliceMark>('uncat/slice/SliceMark')({ from: Bound, to: Bound }) {}

const read = (text: string): { readonly from: number; readonly to: number } => {
  const [, head = '', open, tail] = /^(?::|#L)(\d*)(-)?L?(\d*)$/.exec(text) ?? []
  const from = head === '' ? 0 : Number(head)
  if (open === undefined) return { from, to: from }
  return { from, to: tail === '' || tail === undefined ? 0 : Number(tail) }
}

const write = ({ from, to }: { readonly from: number; readonly to: number }): string =>
  from === 0 ? `:-${to}` : to === from ? `:${from}` : to === 0 ? `:${from}-` : `:${from}-${to}`

const syntaxCodec = Schema.String.check(Schema.isPattern(new RegExp(`^(?:${PATTERN})$`))).pipe(
  Schema.decodeTo(SliceMark, { decode: SchemaGetter.transform(read), encode: SchemaGetter.transform(write) }),
)

const decodeMark = Schema.decodeUnknownSync(syntaxCodec)

const extentOf = (mark: SliceMark): mr.MIR => {
  const first = Math.max(1, mark.from)
  const last = mark.to === 0 ? Infinity : Math.max(1, mark.to)
  return mr.normalize([[Math.min(first, last), Math.max(first, last)]])
}

export const feature: Feature = defineFeature({
  name: NAME,
  syntaxCodec,
  refine: (_, base) => ({
    fragments: [
      ...base.fragments,
      new Fragment({
        feature: NAME,
        position: 'suffix',
        rank: 0,
        sigils: [],
        pattern: () => PATTERN,
        codec: syntaxCodec,
        description: 'Single line, line range, open-ended slice, or #L anchor',
        samples: () => [
          new SliceMark({ from: 5, to: 5 }),
          new SliceMark({ from: 1, to: 5 }),
          new SliceMark({ from: 5, to: 0 }),
          new SliceMark({ from: 0, to: 5 }),
        ],
      }),
    ],
    extent: (node) => {
      const mark = node.meta.marks[NAME]
      return mark === undefined ? base.extent(node) : mr.intersect(base.extent(node), extentOf(decodeMark(mark)))
    },
  }),
})
