/*
 * Extension-slot record of the text-expansion program family together with
 * its neutral base, so every feature can refine named slots while the default
 * behaviour stays an inert identity that knows no concrete syntax or format.
 */
import { Effect, Layer, Schema } from 'effect'
import * as mr from 'multi-integer-range'
import { Ahead } from '../kernel/index.ts'
import {
  Attestation,
  Body,
  Chunk,
  Expansion,
  Fault,
  Fragment,
  Meta,
  Occurrence,
  Payload,
  Presenter,
  Replacement,
  Scanner,
  Setting,
  Signal,
  Source,
  Spawned,
} from './model.ts'

export class Program {
  declare traits: Readonly<Record<string, 'parallel' | 'sequential'>>
  declare settings: ReadonlyArray<Setting<unknown>>
  declare layers: ReadonlyArray<Layer.Layer<never>>
  declare bodies: ReadonlyArray<Body>
  declare fragments: ReadonlyArray<Fragment>
  declare scanners: ReadonlyArray<Scanner>
  declare presenters: ReadonlyArray<Presenter>
  declare mask: (text: string) => Effect.Effect<mr.MIR>
  declare attest: (text: string) => Effect.Effect<ReadonlyArray<Attestation>>
  declare literal: (node: Ahead.Annotated<Meta, unknown>) => Replacement | undefined
  declare interpret: (node: Ahead.Annotated<Meta, unknown>) => Effect.Effect<ReadonlyArray<Source>, Fault>
  declare extent: (node: Ahead.Annotated<Meta, unknown>, total: number) => mr.MIR
  declare enveloping: ReadonlyArray<(node: Ahead.Annotated<Meta, unknown>) => 'yes' | 'no' | 'abstain'>
  declare recursion: ReadonlyArray<
    (node: Ahead.Annotated<Meta, unknown>, source: Source) => Effect.Effect<'yes' | 'no' | 'abstain'>
  >
  declare plan: (
    occurrences: ReadonlyArray<Occurrence>,
    attested: ReadonlyArray<Attestation>,
  ) => ReadonlyMap<string, mr.MIR>
  declare tree: (root: Expansion, attested: ReadonlyArray<Attestation>) => Effect.Effect<string | undefined>
  declare payload: (source: Source, body: string) => Effect.Effect<Payload>
  declare envelope: (source: Source, payload: Payload) => string
  declare reference: (source: Source) => string
  declare chunks: (text: string) => ReadonlyArray<Chunk>
  declare locate: (path: string) => Effect.Effect<string | undefined>
  declare open: (path: string) => Effect.Effect<Source, Fault>
  declare walk: (pattern: string, cwd: string, ignore: boolean) => Effect.Effect<ReadonlyArray<string>, Fault>
  declare spawn: (command: string) => Effect.Effect<Spawned, Fault>
  declare diagnose: (fault: Fault) => Effect.Effect<Fault>
  declare finalize: (text: string) => Effect.Effect<string>
  declare split: (text: string) => Effect.Effect<ReadonlyArray<string>>
  declare name: (target: string, index: number, total: number) => string
  declare observe: (signal: Signal) => Effect.Effect<void>
  constructor(slots: Program) {
    Object.assign(this, slots)
  }
}

const missing = (capability: string) => (subject: string) =>
  Effect.fail(new Fault({ code: 'unsupported', message: `no feature provides ${capability}`, subject, hint: '' }))

export const base = (): Program =>
  new Program({
    traits: {},
    settings: [],
    layers: [],
    bodies: [],
    fragments: [],
    scanners: [],
    presenters: [],
    mask: () => Effect.succeed([]),
    attest: () => Effect.succeed([]),
    literal: () => undefined,
    interpret: (node) => missing('an interpreter')(node.meta.text),
    extent: () => [[1, Infinity]],
    enveloping: [],
    recursion: [],
    plan: () => new Map(),
    tree: () => Effect.succeed(undefined),
    payload: (_, body) => Effect.succeed(new Payload({ attrs: [], body, hidden: 0 })),
    envelope: (_, payload) => payload.body,
    reference: (source) => source.label,
    chunks: () => [],
    locate: () => Effect.succeed(undefined),
    open: missing('file access'),
    walk: missing('directory walking'),
    spawn: missing('subprocess execution'),
    diagnose: Effect.succeed,
    finalize: Effect.succeed,
    split: (text) => Effect.succeed([text]),
    name: (target) => target,
    observe: () => Effect.void,
  })

export class Feature extends Ahead.FeatureSpec<Program, string, string, string, Schema.Codec<unknown, string>> {}

export const defineFeature = (spec: ConstructorParameters<typeof Feature>[0]): Feature => new Feature(spec)

export const verdict = (votes: ReadonlyArray<'yes' | 'no' | 'abstain'>, fallback: boolean): boolean =>
  votes.includes('no') ? false : votes.includes('yes') ? true : fallback

export const whole: mr.MIR = [[1, Infinity]]

export const owns =
  (name: string): ((node: Ahead.Annotated<Meta, unknown>) => boolean) =>
  (node) =>
    node.meta.feature === name
