/*
 * Output sharding that splits a document written to disk into numbered files
 * no larger than a configured size, preferring to cut between located blocks
 * so each shard stays independently readable by an agent.
 */
import { extname } from 'node:path'
import { Effect, Schema } from 'effect'
import { Lines } from '../program/engine.ts'
import { value } from '../program/model.ts'
import { Feature, Program, defineFeature } from '../program/program.ts'

const limit = value({
  key: 'shardLimit',
  description: 'Characters per output file before it is split into numbered shards',
  placeholder: '<chars>',
  codec: Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0)),
  fallback: 350_000,
})

const cuts = (program: Program, text: string): ReadonlyArray<number> => {
  const lines = new Lines(text)
  return program.chunks(text).map((chunk) => lines.start(chunk.from.line) + chunk.from.column - 1)
}

const split = (program: Program, text: string, max: number): ReadonlyArray<string> => {
  const shards: Array<string> = []
  let rest = text
  while (rest.length > max) {
    const block = cuts(program, rest)
      .filter((offset) => offset > max / 2 && offset <= max)
      .at(-1)
    const paragraph = rest.lastIndexOf('\n\n', max)
    const line = rest.lastIndexOf('\n', max)
    const cut = block ?? (paragraph > max / 2 ? paragraph + 2 : line > max / 2 ? line + 1 : max)
    shards.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  return [...shards, rest]
}

const numbered = (target: string, index: number, total: number): string => {
  const extension = extname(target)
  const stem = extension === '' ? target : target.slice(0, -extension.length)
  const digits = String(index).padStart(Math.max(2, String(total).length), '0')
  return `${stem}${stem.endsWith('_') ? '' : '_'}${digits}${extension}`
}

export const feature: Feature = defineFeature({
  name: 'shard',
  refine: (self, base) => ({
    settings: [...base.settings, limit],
    split: (text) =>
      Effect.gen(function* () {
        const parts = yield* base.split(text)
        const max = yield* limit.read
        return parts.flatMap((part) => split(self, part, max))
      }),
    name: (target, index, total) => (total === 1 ? base.name(target, index, total) : numbered(target, index, total)),
  }),
})
