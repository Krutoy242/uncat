/*
 * Machine presenter for coding agents that prints the complete report as one
 * JSON document, embedding the expanded text when no file was written, and is
 * chosen automatically whenever an agent environment is detected.
 */
import { Effect } from 'effect'
import { isAgent } from 'std-env'
import { Presenter } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

export const feature: Feature = defineFeature({
  name: 'json',
  refine: (_, base) => ({
    presenters: [
      ...base.presenters,
      new Presenter({
        name: 'json',
        auto: () => isAgent,
        present: (outcome) =>
          Effect.sync(() => {
            const document = outcome.toStdout ? { ...outcome.report, content: outcome.text } : outcome.report
            process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
          }),
      }),
    ],
  }),
})
