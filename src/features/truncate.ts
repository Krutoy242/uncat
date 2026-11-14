/*
 * Per-source quota that elides the middle of an oversized payload, keeping its
 * opening and closing lines around a marker that states exactly how much was
 * hidden, so one huge file cannot crowd out the rest of the context.
 */
import { Effect, Schema } from 'effect'
import { Payload, value } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const limit = value({
  key: 'sourceLimit',
  description: 'Characters kept from a single source before its middle is elided',
  placeholder: '<chars>',
  codec: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
  fallback: 350_000,
})

const elide = (text: string, max: number): { readonly body: string; readonly hidden: number } => {
  const half = Math.max(1, Math.floor(max / 2))
  const breakBefore = text.lastIndexOf('\n', half)
  const head = breakBefore >= half / 2 ? breakBefore + 1 : half
  const breakAfter = text.indexOf('\n', text.length - half)
  const tail = breakAfter !== -1 && breakAfter <= text.length - half / 2 ? breakAfter : text.length - half
  const end = Math.max(head, tail)
  return { body: `${text.slice(0, head)}⟪ ${end - head} chars hidden ⟫${text.slice(end)}`, hidden: end - head }
}

export const feature: Feature = defineFeature({
  name: 'truncate',
  refine: (_, base) => ({
    settings: [...base.settings, limit],
    payload: (source, body) =>
      Effect.gen(function* () {
        const payload = yield* base.payload(source, body)
        const max = yield* limit.read
        if (payload.body.length <= max) return payload
        const cut = elide(payload.body, max)
        return new Payload({ attrs: payload.attrs, body: cut.body, hidden: payload.hidden + cut.hidden })
      }),
  }),
})
