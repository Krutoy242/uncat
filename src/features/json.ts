/*
 * Machine presenter that prints the complete report as one JSON document,
 * embedding the expanded text when no target output file was requested.
 */
import { Effect } from 'effect'
import { Presenter } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

export const feature: Feature = defineFeature({
  name: 'json',
  refine: (_, base) => ({
    presenters: [
      ...base.presenters,
      new Presenter({
        name: 'json',
        auto: () => false,
        present: (outcome) =>
          Effect.sync(() => {
            const document = outcome.toStdout ? { ...outcome.report, content: outcome.text } : outcome.report
            process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
          }),
      }),
    ],
  }),
})
