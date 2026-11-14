/*
 * Path resolution policy that prefers the directory of the document currently
 * being expanded before falling back to the working directory, so nested
 * references behave like links relative to the file that contains them.
 */
import { isAbsolute, resolve } from 'node:path'
import { Effect } from 'effect'
import { Ambient } from '../kernel/index.ts'
import { Feature, defineFeature } from '../program/program.ts'

export const feature: Feature = defineFeature({
  name: 'scope',
  requires: ['file'],
  refine: (_, base) => ({
    locate: (path) =>
      Effect.gen(function* () {
        const frame = yield* Ambient.Current
        if (isAbsolute(path) || path.startsWith('~') || frame.scope === frame.root) return yield* base.locate(path)
        const nearby = yield* base.locate(resolve(frame.scope, path))
        return nearby ?? (yield* base.locate(path))
      }),
  }),
})
