/*
 * Domain-blind feature algebra: an environment comonad that keeps metadata
 * beside payloads, and an AHEAD synthesizer that folds independently written
 * refinements over a base record while enforcing composition design rules.
 */
import { Data } from 'effect'

export class Annotated<in out Meta, out Payload> {
  readonly meta: Meta
  readonly payload: Payload
  constructor(meta: Meta, payload: Payload) {
    this.meta = meta
    this.payload = payload
  }
}

export const extract = <Meta, Payload>(node: Annotated<Meta, Payload>): Payload => node.payload

export const extend = <Meta, A, B>(node: Annotated<Meta, A>, f: (node: Annotated<Meta, A>) => B): Annotated<Meta, B> =>
  new Annotated(node.meta, f(node))

export const map = <Meta, A, B>(node: Annotated<Meta, A>, f: (payload: A) => B): Annotated<Meta, B> =>
  extend(node, (self) => f(self.payload))

export const duplicate = <Meta, A>(node: Annotated<Meta, A>): Annotated<Meta, Annotated<Meta, A>> =>
  extend(node, (self) => self)

export const lift =
  <Meta>(meta: Meta): (<Payload>(payload: Payload) => Annotated<Meta, Payload>) =>
  (payload) =>
    new Annotated(meta, payload)

export class FeatureSpec<
  in out Kernel extends object,
  out Name extends string = string,
  out Req extends string = string,
  out Excl extends string = string,
  out Codec = unknown,
> {
  declare readonly name: Name
  declare readonly requires: ReadonlyArray<Req>
  declare readonly excludes: ReadonlyArray<Excl>
  declare readonly concurrency: 'parallel' | 'sequential'
  declare readonly syntaxCodec: Codec | undefined
  declare readonly refine: (self: Kernel, base: Kernel) => Partial<Kernel>
  constructor(spec: {
    readonly name: Name
    readonly requires?: ReadonlyArray<Req>
    readonly excludes?: ReadonlyArray<Excl>
    readonly concurrency?: 'parallel' | 'sequential'
    readonly syntaxCodec?: Codec
    readonly refine: (self: Kernel, base: Kernel) => Partial<Kernel>
  }) {
    Object.assign(this, { requires: [], excludes: [], concurrency: 'parallel', syntaxCodec: undefined }, spec)
  }
}

export class DesignRuleViolation extends Data.Error<{
  readonly feature: string
  readonly rule: 'requires' | 'excludes' | 'unique'
  readonly other: string
}> {
  readonly _tag = 'DesignRuleViolation' as const
  override get message(): string {
    return `feature "${this.feature}" violates ${this.rule} rule against "${this.other}"`
  }
}

export class Synthesized<in out Kernel extends object, out Features> {
  readonly kernel: Kernel
  readonly features: Features
  constructor(kernel: Kernel, features: Features) {
    this.kernel = kernel
    this.features = features
  }
}

type AnySpec<Kernel extends object> = FeatureSpec<Kernel>

type Unsatisfied<Kernel extends object, Features extends ReadonlyArray<AnySpec<Kernel>>> = Exclude<
  Features[number] extends FeatureSpec<Kernel, string, infer Req> ? Req : never,
  Features[number]['name']
>

type DesignRules<Kernel extends object, Features extends ReadonlyArray<AnySpec<Kernel>>> = [
  Unsatisfied<Kernel, Features>,
] extends [never]
  ? Features
  : { readonly unsatisfiedRequirement: Unsatisfied<Kernel, Features> }

const verify = <Kernel extends object>(features: ReadonlyArray<AnySpec<Kernel>>): void => {
  const names = new Set<string>()
  for (const feature of features) {
    if (names.has(feature.name))
      throw new DesignRuleViolation({ feature: feature.name, rule: 'unique', other: feature.name })
    names.add(feature.name)
  }
  for (const feature of features) {
    const missing = feature.requires.find((name) => !names.has(name))
    if (missing !== undefined)
      throw new DesignRuleViolation({ feature: feature.name, rule: 'requires', other: missing })
    const clash = feature.excludes.find((name) => names.has(name))
    if (clash !== undefined) throw new DesignRuleViolation({ feature: feature.name, rule: 'excludes', other: clash })
  }
}

export const synthesize = <Kernel extends object, const Features extends ReadonlyArray<AnySpec<Kernel>>>(
  base: () => Kernel,
  features: Features & DesignRules<Kernel, Features>,
): Synthesized<Kernel, Features> => {
  verify(features)
  const self = base()
  for (const feature of features) {
    const before: Kernel = { ...self }
    Object.assign(self, feature.refine(self, before))
  }
  return new Synthesized(self, features)
}
