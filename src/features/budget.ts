/*
 * Whole-output quota that caps the finished document at a line boundary and
 * appends a marker naming how much was dropped, protecting downstream agents
 * from contexts larger than they can accept.
 */
import { Effect, Schema } from 'effect'
import { Signal, value } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const limit = value({
  key: 'totalLimit',
  description: 'Characters allowed in the whole expanded output',
  placeholder: '<chars>',
  codec: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
  fallback: 2_000_000,
})

export const feature: Feature = defineFeature({
  name: 'budget',
  refine: (self, base) => ({
    settings: [...base.settings, limit],
    finalize: (text) =>
      Effect.gen(function* () {
        const finished = yield* base.finalize(text)
        const max = yield* limit.read
        if (finished.length <= max) return finished
        const boundary = finished.lastIndexOf('\n', max)
        const cut = boundary >= max / 2 ? boundary : max
        const omitted = finished.length - cut
        yield* self.observe(
          new Signal({
            kind: 'fault',
            id: 'budget',
            parent: '',
            label: 'output',
            depth: 0,
            bytes: omitted,
            detail: `output capped, ${omitted} chars omitted`,
          }),
        )
        return `${finished.slice(0, cut)}\n⟪ output capped: ${omitted} chars omitted ⟫\n`
      }),
  }),
})
