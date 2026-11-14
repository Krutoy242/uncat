/*
 * Actionable diagnostics for references that cannot be found, ranking real
 * project paths against the missing one with a typo-tolerant fuzzy matcher so
 * every not-found error arrives with concrete suggestions to try instead.
 */
import { relative, sep } from 'node:path'
import uFuzzy from '@leeoniya/ufuzzy'
import { Context, Effect, Layer } from 'effect'
import { Ambient } from '../kernel/index.ts'
import { Fault } from '../program/model.ts'
import { Feature, defineFeature } from '../program/program.ts'

const SUGGESTIONS = 3

class FuzzyPort extends Context.Service<FuzzyPort>()('uncat/fuzzy/FuzzyPort', {
  make: Effect.sync(() => {
    const haystacks = new Map<string, ReadonlyArray<string>>()
    const finder = new uFuzzy({
      // oxlint-disable-next-line typescript/no-unsafe-enum-assignment -- the library publishes its modes as an ambient const enum that isolated modules cannot name
      intraMode: 1,
      intraIns: 1,
      intraSub: 1,
      intraTrn: 1,
      intraDel: 1,
      intraSlice: [0, Infinity],
    })
    return {
      remember: (root: string, files: ReadonlyArray<string>): ReadonlyArray<string> => {
        haystacks.set(root, files)
        return files
      },
      recall: (root: string): ReadonlyArray<string> | undefined => haystacks.get(root),
      rank: (haystack: ReadonlyArray<string>, needle: string): ReadonlyArray<string> => {
        const [indexes, info, order] = finder.search([...haystack], needle, 0, 1e3)
        const ranked =
          order === null || info === null ? (indexes ?? []) : order.map((position) => info.idx[position] ?? -1)
        return ranked.flatMap((index) => (index === -1 ? [] : [haystack[index] ?? '']))
      },
    }
  }),
}) {
  static readonly layer: Layer.Layer<FuzzyPort> = Layer.unwrap(
    Effect.sync(() => Layer.effect(FuzzyPort, FuzzyPort.make)),
  )
}

export const feature: Feature = defineFeature({
  name: 'fuzzy',
  requires: ['glob'],
  refine: (self, base) => ({
    layers: [...base.layers, FuzzyPort.layer],
    diagnose: (fault) =>
      fault.code !== 'not-found' || fault.hint !== ''
        ? base.diagnose(fault)
        : Effect.gen(function* () {
            const frame = yield* Ambient.Current
            const port = yield* FuzzyPort
            const haystack =
              port.recall(frame.root) ??
              port.remember(
                frame.root,
                (yield* self.walk('**/*', frame.root, true).pipe(Effect.catch(() => Effect.succeed([]))))
                  .slice(0, 20_000)
                  .map((file) => relative(frame.root, file).split(sep).join('/')),
              )
            const needle = fault.subject.replace(/^\.\//, '')
            const folder = needle.includes('/') ? needle.slice(0, needle.lastIndexOf('/') + 1) : ''
            const needles = [needle, needle.slice(folder.length), folder]
            const best =
              needles
                .filter((term) => term !== '')
                .map((term) => port.rank(haystack, term))
                .find((ranked) => ranked.length > 0)
                ?.slice(0, SUGGESTIONS) ?? []
            const hint =
              best.length === 0
                ? 'no similar paths found'
                : `did you mean ${best.map((path) => `\`${path}\``).join(', ')}?`
            return yield* base.diagnose(
              new Fault({ code: fault.code, message: fault.message, subject: fault.subject, hint }),
            )
          }).pipe(Effect.provide(FuzzyPort.layer)),
  }),
})
