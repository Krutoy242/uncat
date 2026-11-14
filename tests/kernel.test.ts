/*
 * Algebraic laws of the domain-blind kernel, checked over generated values:
 * comonad identities of the annotation envelope, order preservation of the
 * trait-partitioned scheduler, and rejection of invalid feature equations.
 */
import { assert, describe, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  Annotated,
  DesignRuleViolation,
  FeatureSpec,
  duplicate,
  extend,
  extract,
  map,
  synthesize,
} from '../src/kernel/ahead.ts'
import { lower } from '../src/kernel/schedule.ts'

const Pair = Schema.Tuple([Schema.String, Schema.Int])

describe('comonadic annotation', () => {
  it.prop(
    'extract after duplicate is identity',
    [Pair],
    ([[meta, payload]]) => {
      const node = new Annotated(meta, payload)
      const twice = duplicate(node)
      return extract(extract(twice)) === payload && extract(twice).meta === meta
    },
    { arbitrary: { runs: 15 } },
  )

  it.prop(
    'extend with extract is identity',
    [Pair],
    ([[meta, payload]]) => {
      const node = extend(new Annotated(meta, payload), extract)
      return node.meta === meta && node.payload === payload
    },
    { arbitrary: { runs: 15 } },
  )

  it.prop(
    'map composes and never touches metadata',
    [Pair],
    ([[meta, payload]]) => {
      const node = new Annotated(meta, payload)
      const twice = map(
        map(node, (value) => value + 1),
        (value) => value * 2,
      )
      return twice.meta === meta && twice.payload === map(node, (value) => (value + 1) * 2).payload
    },
    { arbitrary: { runs: 15 } },
  )
})

describe('trait-partitioned scheduler', () => {
  it.effect.prop(
    'returns results in input order for any trait mix',
    [Schema.Array(Schema.Tuple([Schema.Int, Schema.Boolean]))],
    ([items]) =>
      Effect.gen(function* () {
        const order: Array<number> = []
        const results = yield* lower(
          items,
          ([, sequential]) => (sequential ? 'sequential' : 'parallel'),
          ([value, sequential]) =>
            Effect.sync(() => {
              if (sequential) order.push(value)
              return value
            }),
        )
        const expectedSequential = items.filter(([, sequential]) => sequential).map(([value]) => value)
        assert.deepStrictEqual(
          results,
          items.map(([value]) => value),
        )
        assert.deepStrictEqual(order, expectedSequential)
      }),
    { arbitrary: { runs: 15 } },
  )
})

describe('feature equation', () => {
  class Counter {
    declare count: number
    declare trail: ReadonlyArray<string>
    constructor(fields: Counter) {
      Object.assign(this, fields)
    }
  }
  const base = (): Counter => new Counter({ count: 0, trail: [] })
  const step = (name: string, requires: ReadonlyArray<string> = [], excludes: ReadonlyArray<string> = []) =>
    new FeatureSpec<Counter>({
      name,
      requires,
      excludes,
      refine: (_, previous) => ({ count: previous.count + 1, trail: [...previous.trail, name] }),
    })

  it('folds refinements in order over the base', () => {
    const { kernel } = synthesize(base, [step('a'), step('b', ['a'])])
    assert.strictEqual(kernel.count, 2)
    assert.deepStrictEqual(kernel.trail, ['a', 'b'])
  })

  it('rejects unmet requirements, exclusions and duplicates', () => {
    const attempts: ReadonlyArray<ReadonlyArray<FeatureSpec<Counter>>> = [
      [step('a', ['missing'])],
      [step('a'), step('b', [], ['a'])],
      [step('a'), step('a')],
    ]
    for (const features of attempts) {
      assert.throws(() => synthesize(base, features), DesignRuleViolation)
    }
  })
})
