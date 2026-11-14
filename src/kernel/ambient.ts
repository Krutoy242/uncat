/*
 * Fiber-local execution frame that carries correlation, scope, depth,
 * lineage and settings implicitly, so nested work can change its context
 * locally without copying that state into nodes or function parameters.
 */
import { Context, Data, Effect } from 'effect'

export class Frame extends Data.Class<{
  readonly correlationId: string
  readonly scope: string
  readonly root: string
  readonly depth: number
  readonly lineage: ReadonlyArray<string>
  readonly settings: Readonly<Record<string, unknown>>
}> {}

export const Current: Context.Reference<Frame> = Context.Reference<Frame>('kernel/Ambient', {
  defaultValue: () => new Frame({ correlationId: '', scope: '', root: '', depth: 0, lineage: [], settings: {} }),
})

export const within =
  (patch: Partial<Frame>): (<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>) =>
  (effect) =>
    Effect.flatMap(Current, (frame) => Effect.provideService(effect, Current, new Frame({ ...frame, ...patch })))

export const descend =
  (step: {
    readonly correlationId: string
    readonly scope: string
    readonly identity: string
  }): (<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>) =>
  (effect) =>
    Effect.flatMap(Current, (frame) =>
      Effect.provideService(
        effect,
        Current,
        new Frame({
          ...frame,
          correlationId: step.correlationId,
          scope: step.scope,
          depth: frame.depth + 1,
          lineage: step.identity === '' ? frame.lineage : [...frame.lineage, step.identity],
        }),
      ),
    )
