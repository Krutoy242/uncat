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

const PATTERN = String.raw`:[1-9]\d*(?:-[1-9]\d*)?|:-[1-9]\d*|#L[1-9]\d*(?:-L?[1-9]\d*)?`

const From = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9_999_999 }))

const To = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9_999_999 }))

class SliceMark extends Schema.Class<SliceMark>('uncat/slice/SliceMark')({ from: From, to: To }) {}

const read = (text: string): { readonly from: number; readonly to: number } => {
  const [, head = '', open, tail = ''] = /^(?::|#L)(\d*)(-)?L?(\d*)$/.exec(text) ?? []
  const from = head === '' ? 0 : Number(head)
  return { from, to: open === undefined ? from : Number(tail) }
}

const write = ({ from, to }: { readonly from: number; readonly to: number }): string =>
  from === 0 ? `:-${to}` : to === from ? `:${from}` : `:${from}-${to}`

const syntaxCodec = Schema.String.check(Schema.isPattern(new RegExp(`^(?:${PATTERN})$`))).pipe(
  Schema.decodeTo(SliceMark, { decode: SchemaGetter.transform(read), encode: SchemaGetter.transform(write) }),
)

const decodeMark = Schema.decodeUnknownSync(syntaxCodec)

const extentOf = (mark: SliceMark, total: number): mr.MIR =>
  mark.from === 0
    ? [[Math.max(1, total - mark.to + 1), Math.max(1, total)]]
    : mr.normalize([[Math.min(mark.from, mark.to), Math.max(mark.from, mark.to)]])

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
        description: 'Single line, line range, tail slice, or #L anchor',
        samples: () => [
          new SliceMark({ from: 5, to: 5 }),
          new SliceMark({ from: 1, to: 5 }),
          new SliceMark({ from: 0, to: 5 }),
        ],
      }),
    ],
    extent: (node, total) => {
      const mark = node.meta.marks[NAME]
      return mark === undefined
        ? base.extent(node, total)
        : mr.intersect(base.extent(node, total), extentOf(decodeMark(mark), total))
    },
  }),
})
