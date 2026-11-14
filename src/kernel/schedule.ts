/*
 * Generic lowering scheduler that partitions work by each item's declared
 * concurrency trait, running independent items in parallel and ordered items
 * as a sequential fold, while always returning results in input order.
 */
import { Effect } from 'effect'

export const lower = <A, B, E, R>(
  items: ReadonlyArray<A>,
  trait: (item: A) => 'parallel' | 'sequential',
  run: (item: A) => Effect.Effect<B, E, R>,
): Effect.Effect<ReadonlyArray<B>, E, R> => {
  const indexed = items.map((item, index) => ({ item, index }))
  const lane = (kind: 'parallel' | 'sequential') =>
    Effect.forEach(
      indexed.filter(({ item }) => trait(item) === kind),
      ({ item, index }) => Effect.map(run(item), (value) => ({ value, index })),
      { concurrency: kind === 'parallel' ? 'unbounded' : 1 },
    )
  return Effect.map(Effect.all([lane('parallel'), lane('sequential')], { concurrency: 2 }), ([parallel, sequential]) =>
    [...parallel, ...sequential].toSorted((left, right) => left.index - right.index).map(({ value }) => value),
  )
}
