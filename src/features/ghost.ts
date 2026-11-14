/*
 * Ghost mode that keeps the full expansion hierarchy but swaps every payload
 * for its line and character counts, giving a cheap preview of what a real
 * expansion would include and how large each part would be.
 */
import { Effect } from 'effect'
import { Payload, flag } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const ghost = flag({
  key: 'ghost',
  alias: 'g',
  description: 'Keep the hierarchy but replace payloads with their sizes',
})

export const feature: Feature = defineFeature({
  name: 'ghost',
  refine: (_, base) => ({
    settings: [...base.settings, ghost],
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
