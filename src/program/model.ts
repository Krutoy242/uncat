/*
 * Dual-space carriers shared by the expansion engine and every feature, each
 * a value that is also its own type, so contracts travel between independently
 * written modules without separate type declarations or duplication.
 */
import { Data, Effect, Schema } from 'effect'
import * as mr from 'multi-integer-range'
import { Ahead, Ambient } from '../kernel/index.ts'

export class Span extends Data.Class<{ readonly start: number; readonly end: number }> {}

export class Meta extends Data.Class<{
  readonly id: string
  readonly feature: string
  readonly span: Span
  readonly line: number
  readonly placement: 'standalone' | 'inline'
  readonly marks: Readonly<Record<string, string>>
  readonly label: string
  readonly text: string
  readonly tentative: boolean
}> {}

export class Hit extends Data.Class<{ readonly span: Span; readonly payload: unknown; readonly label: string }> {}

export class Body extends Data.Class<{
  readonly feature: string
  readonly sigil: string
  readonly pattern: string
  readonly accepts: ReadonlyArray<'lead' | 'prefix' | 'suffix'>
  readonly priority: number
  readonly label: (body: string, suffix: string) => string
  readonly codec: Schema.Codec<unknown, string>
  readonly description: string
  readonly samples: ReadonlyArray<unknown>
}> {}

export const quoted = (body: string, suffix: string): string => `\`${body}${suffix}\``

export const verbatim = (body: string, suffix: string): string => `${body}${suffix}`

export const identityOf = (tag: string, location: string): string => `${tag}:${location}`

export class Fragment extends Data.Class<{
  readonly feature: string
  readonly position: 'lead' | 'prefix' | 'suffix'
  readonly rank: number
  readonly sigils: ReadonlyArray<string>
  readonly pattern: (sigil: string) => string
  readonly codec: Schema.Codec<unknown, string>
  readonly description: string
  readonly samples: (sigil: string) => ReadonlyArray<unknown>
}> {}

export class Scanner extends Data.Class<{
  readonly feature: string
  readonly priority: number
  readonly tentative: boolean
  readonly codec: Schema.Codec<unknown, string>
  readonly description: string
  readonly samples: ReadonlyArray<unknown>
  readonly scan: (text: string) => Effect.Effect<ReadonlyArray<Hit>>
}> {}

export class SyntaxEntry extends Data.Class<{
  readonly feature: string
  readonly tokens: ReadonlyArray<string>
  readonly description: string
}> {}

export class Source extends Data.Class<{
  readonly tag: string
  readonly attrs: ReadonlyArray<readonly [string, string]>
  readonly identity: string
  readonly label: string
  readonly scope: string
  readonly kind: string
  readonly text: string
  readonly extent: mr.MIR
}> {}

export class Payload extends Data.Class<{
  readonly attrs: ReadonlyArray<readonly [string, string]>
  readonly body: string
  readonly hidden: number
}> {}

export class Replacement extends Data.Class<{ readonly text: string; readonly collapse: boolean }> {}

export class Branch extends Data.Class<{
  readonly id: string
  readonly source: Source
  readonly children: Expansion | undefined
}> {}

export class Expanded extends Data.Class<{
  readonly node: Ahead.Annotated<Meta, unknown>
  readonly literal: Replacement | undefined
  readonly branches: ReadonlyArray<Branch>
  readonly fault: Fault | undefined
  readonly enveloped: boolean
  readonly depth: number
}> {}

export class Expansion extends Data.Class<{
  readonly text: string
  readonly window: mr.MIR
  readonly nodes: ReadonlyArray<Expanded>
}> {}

export class Attestation extends Data.Class<{ readonly identity: string; readonly extent: mr.MIR }> {}

export class Occurrence extends Data.Class<{ readonly identity: string; readonly extent: mr.MIR }> {}

export class Spawned extends Data.Class<{
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly durationMs: number
  readonly cwd: string
}> {}

export class Fault extends Data.Error<{
  readonly code: string
  readonly message: string
  readonly subject: string
  readonly hint: string
}> {
  readonly _tag = 'Fault' as const
}

export class Position extends Data.Class<{ readonly line: number; readonly column: number }> {}

export class Chunk extends Data.Class<{
  readonly tag: string
  readonly label: string
  readonly identity: string
  readonly file: string
  readonly from: Position
  readonly to: Position
}> {}

export class Diagnostic extends Data.Class<{
  readonly code: string
  readonly message: string
  readonly subject: string
  readonly hint: string
  readonly depth: number
}> {}

export class OutputFile extends Data.Class<{
  readonly path: string
  readonly bytes: number
  readonly chars: number
  readonly lines: number
}> {}

export class Report extends Data.Class<{
  readonly mode: string
  readonly outputs: ReadonlyArray<OutputFile>
  readonly chunks: ReadonlyArray<Chunk>
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly sources: number
  readonly bytes: number
  readonly chars: number
  readonly lines: number
  readonly elapsedMs: number
}> {}

export class Outcome extends Data.Class<{
  readonly text: string
  readonly report: Report
  readonly toStdout: boolean
}> {}

export class Signal extends Data.Class<{
  readonly kind: 'begin' | 'open' | 'close' | 'fault' | 'write' | 'end'
  readonly id: string
  readonly parent: string
  readonly label: string
  readonly depth: number
  readonly bytes: number
  readonly detail: string
}> {}

export class Presenter extends Data.Class<{
  readonly name: string
  readonly auto: () => boolean
  readonly present: (outcome: Outcome) => Effect.Effect<void>
}> {}

export class Setting<out A> {
  readonly key: string
  readonly kind: 'flag' | 'value'
  readonly description: string
  readonly alias: string
  readonly placeholder: string
  readonly codec: Schema.Codec<A, unknown>
  readonly fallback: A
  readonly read: Effect.Effect<A>
  constructor(spec: {
    readonly key: string
    readonly kind: 'flag' | 'value'
    readonly description: string
    readonly alias?: string
    readonly placeholder?: string
    readonly codec: Schema.Codec<A, unknown>
    readonly fallback: A
  }) {
    this.key = spec.key
    this.kind = spec.kind
    this.description = spec.description
    this.alias = spec.alias ?? ''
    this.placeholder = spec.placeholder ?? ''
    this.codec = spec.codec
    this.fallback = spec.fallback
    const guard = Schema.decodeUnknownSync(Schema.toType(spec.codec))
    this.read = Effect.map(Ambient.Current, (frame) => {
      const raw = frame.settings[spec.key]
      if (raw === undefined || raw === spec.fallback) return spec.fallback
      return guard(raw)
    })
  }
}

export const flag = (spec: {
  readonly key: string
  readonly description: string
  readonly alias?: string
  readonly fallback?: boolean
}): Setting<boolean> => new Setting({ ...spec, kind: 'flag', codec: Schema.Boolean, fallback: spec.fallback ?? false })

export const value = <A>(spec: {
  readonly key: string
  readonly description: string
  readonly alias?: string
  readonly placeholder?: string
  readonly codec: Schema.Codec<A, string>
  readonly fallback: A
}): Setting<A> => new Setting({ ...spec, kind: 'value' })
