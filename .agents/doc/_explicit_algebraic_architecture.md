# Explicit Algebraic Architecture

---

# Part I. Feature-Oriented Programming (FOP / AHEAD), Native Layers & Comonadic Lifting

## 1. Theoretical Foundation: Variadic AHEAD Synthesis, Domain-Blind Microkernel & Comonadic Envelopes

**Core thesis:** Programs are not monolithic graphs, central type registries, or imperative `if/else` cascades; a system belongs to a _program family_ synthesized via **Algebraic Hierarchical Equations for Application Design (AHEAD)** (Batory et al., IEEE TSE 2004), **Step-Wise Refinement (SWR)**, and **Comonadic Context Lifting**, backed natively by `Effect` v4 service layers.

- **Domain-Blind Microkernel ($K_0$):** The foundational constant knows zero domain rules, zero CLI/transport flags, and zero concrete entity variants. It defines only generic **Extension Slots** (e.g., recognition slot, whole-graph algebraic pass slot, effectful interpretation slot, envelope formatting slot), **Comonadic Lifters**, and open execution traits (such as parallel vs. sequential scheduling).
- **Autonomous Vertical Feature Operators ($F_i$) & Compile-Time Discovery:** Each feature resides in a single self-contained module (`src/features/*.ts`) encapsulating its own options schema, bidirectional syntax/boundary codec, granular effect port, and interpreter. Features are never imported by name; a compile-time virtual module (`virtual:ahead-features`) discovers all feature modules via `tinyglobby` and re-exports them as `/* @__PURE__ */` bindings so the entrypoint folds a variadic tuple of features while preserving surgical tree-shaking:

$$P = \text{synthesize}\left(K_0, \langle F_1, F_2, \dots, F_n \rangle\right)$$

- **Comonadic Metadata Lifting ($W A = \text{Meta} \times A$):** Dual to monadic effects, cross-cutting structural and operational metadata (deterministic IDs, source spans, byte lengths, line placement `'standalone' | 'hoisted'`, timestamps, or orthogonal modifiers) form an **Env / Cofree Comonad (`Annotated<Meta, Payload>`)** managed exclusively by the kernel. Feature modules return only their minimal 2–3 field semantic payload; the kernel's higher-order combinator lifts that payload into a full annotated node automatically. Repeating cross-cutting metadata fields across feature modules is a critical architectural violation.
- **Compile-Time Design Rules (DR) without `any`:** Compositional validity is governed by static preconditions ($\text{Req}_i$) and postconditions ($\text{Prov}_i$, $\text{Excl}_i$) verified across variadic feature tuples at compile time with zero `any` types using TypeScript 7 variance annotations (`in out` / `out`).

---

## 2. Ecosystem Constraints (TypeScript 7 / `tsgo` / Oxc / Node 26 LTS)

1. **`isolatedDeclarations: true` & Dual-Space Value-Level Types (Zero `import type` / `export type`):** Modern build pipelines (`tsdown` + `rolldown-plugin-dts` using `oxc-transform` on TypeScript 7.0+ and Node 26 LTS) emit `.d.ts` files per module in parallel without invoking a full cross-file type-checker pass, while `verbatimModuleSyntax: true` forbids importing pure types without `type` modifiers. To eliminate `import type`, `export type`, and `export interface` entirely, every exported contract is declared as a **Dual-Space Value-Type Class** (`Schema.Class`, `Schema.TaggedError`, `Context.Service`, or a carrier `class`) and modules re-export themselves as runtime namespaces (`export * as Name from './module.ts'`).
2. **`tsgo` (TypeScript 7) Variance Short-Circuiting:** Parametric classes with explicit `in out` and `out` variance annotations allow TypeScript 7's parallel checker workers (`tsgo`) to verify structural assignability directly from variance marks without deep structural expansion or `any` fallbacks.

---

## 3. Core Pattern: Variadic Zero-`any` AHEAD Kernel with Comonadic Lifting

```ts
/*
 * Defines the domain-blind AHEAD microkernel, comonadic metadata envelope, and
 * variadic feature synthesizer using dual-space classes with zero any or type exports.
 */
import { Schema } from 'effect'

export class Annotated<in out Meta, out Payload> {
  readonly meta: Meta
  readonly payload: Payload
  constructor(meta: Meta, payload: Payload) {
    this.meta = meta
    this.payload = payload
  }
}

export function extractAnnotated<Meta, Payload>(node: Annotated<Meta, Payload>): Payload {
  return node.payload
}

export function mapAnnotated<Meta, A, B>(node: Annotated<Meta, A>, f: (payload: A) => B): Annotated<Meta, B> {
  return new Annotated(node.meta, f(node.payload))
}

export class FeatureSpec<
  in out Kernel extends object = object,
  out Name extends string = string,
  out Req extends string = never,
  out Excl extends string = never,
  out Codec extends Schema.Top = Schema.Top,
  out Options extends Schema.Top = Schema.Top,
> {
  declare readonly name: Name
  declare readonly requires?: readonly Req[]
  declare readonly excludes?: readonly Excl[]
  declare readonly syntaxCodec: Codec
  declare readonly optionsSchema?: Options
  declare readonly concurrency?: 'parallel' | 'sequential'
  declare readonly refine: (self: Kernel, base: Kernel) => Partial<Kernel>

  constructor(spec: {
    readonly name: Name
    readonly requires?: readonly Req[]
    readonly excludes?: readonly Excl[]
    readonly syntaxCodec: Codec
    readonly optionsSchema?: Options
    readonly concurrency?: 'parallel' | 'sequential'
    readonly refine: (self: Kernel, base: Kernel) => Partial<Kernel>
  }) {
    Object.assign(this, spec)
  }
}

export function defineFeature<
  Kernel extends object,
  const Name extends string = string,
  const Req extends string = never,
  const Excl extends string = never,
  Codec extends Schema.Top = Schema.Top,
  Options extends Schema.Top = Schema.Top,
>(spec: FeatureSpec<Kernel, Name, Req, Excl, Codec, Options>): FeatureSpec<Kernel, Name, Req, Excl, Codec, Options> {
  return spec
}

export class SynthesizedSystem<
  in out Kernel extends object,
  out Features extends readonly FeatureSpec<Kernel, string, string, string>[],
> {
  readonly kernel: Kernel
  readonly features: Features
  constructor(kernel: Kernel, features: Features) {
    this.kernel = kernel
    this.features = features
  }
}

export function synthesizeEquation<
  Kernel extends object,
  const Features extends readonly FeatureSpec<Kernel, string, string, string>[],
>(baseFactory: (self: Kernel) => Kernel, features: Features): SynthesizedSystem<Kernel, Features> {
  const kernel = {} as Kernel
  const base = baseFactory(kernel)
  Object.assign(kernel, base)
  for (const feature of features) {
    const currentSnapshot = { ...kernel }
    Object.assign(kernel, feature.refine(kernel, currentSnapshot))
  }
  return new SynthesizedSystem(kernel, features)
}

export * as AheadKernel from './ahead.ts'
```

---

# Part II. Dependent Schemas, Bidirectional Codecs & Irreversible Operations (`Effect.Schema` v4)

## 1. Formal Foundations: Library-Backed Tarski Universes ($\mathcal{U}_0 \subset \mathcal{U}_1$) & Invertible Syntax

Instead of hand-rolling custom runtime type tags or imperative `if/else` prefix parsers, modern TypeScript 7 architectures use **`Effect.Schema` v4** (and **Standard Schema v1**) directly as the reified $\mathcal{U}_0$ universe:

- **Single Source of Truth ($\mathcal{U}\_0$):** Each vertical feature declares its own configuration slice (`optionsSchema`) and its **bidirectional syntax codec (`syntaxCodec`)** inside its feature module using `Schema.Class` or `Schema.decodeTo`.
- **Simultaneous Projections ($\text{El} : \mathcal{U}\_0 \to \mathcal{U}\_1$):** From a single `Schema.Class` value in a feature module, the architecture automatically projects:

1. Dual-space TypeScript 7 types (`ModifierProduct` directly as a class type, or `typeof MySchema.Type` / `typeof MySchema.Encoded`) with zero `export type` or `import type`.
2. Declarative boundary parsing (`Schema.decodeUnknownSync` / `Schema.decodeUnknownEffect`) and **Standard Schema v1** (`Schema.standardSchemaV1`) passed directly into `privatenumber/cleye` flag definitions without central option lists.
3. Declarative code-fence exclusion: Markdown code blocks (```, `~~~`) are recognized as `[start, end]` intervals and algebraically subtracted from candidate token spans via `multi-integer-range` (`mr.subtract`) with zero `if/else` state flags.
4. Syntax-agnostic Property-Based Testing: the Law Runner generates valid domain AST values via `Arbitrary.schema(feature.syntaxCodec)` and encodes them back into concrete syntax strings via `Schema.encodeSync(feature.syntaxCodec)`—so test files never hardcode concrete domain tokens or sigils.

- **Handling Irreversible Operations (Comments, `.hash()`, Subprocess Execution, Widening Deduplication):**

1. **Reversible Command AST vs. Irreversible Interpreter:** Separate _syntax recognition_ from _effectful evaluation_. The `syntaxCodec` encodes and decodes only the **command AST description** (e.g., `decode: "@##note" <-> new CommentToken({ body: "note", bracketed: false })` or `decode: "!`ls`" <-> new ShellToken({ cmd: "ls" })`), which is 100% invertible for round-trip law verification ($\text{decode}(\text{encode}(\text{ast})) \equiv \text{ast}$), while irreversible comment stripping, `nano-spawn` subprocess execution, or interval-widening deduplication execute inside downstream algebraic passes and `Effect` interpreters.
2. **Metamorphic Law Verification:** Irreversible downstream evaluations are verified via metamorphic laws (comment annihilation, escape preservation, quota conservation `head + tail + hidden === total`, and idempotence).

```ts
/*
 * Demonstrates a dual-space Schema.Class product-algebra codec and Standard
 * Schema v1 projection for cleye without export type or if/else cascades.
 */
import { Arbitrary, Schema } from 'effect'

export class ModifierProduct extends Schema.Class<ModifierProduct>('feature/ModifierProduct')({
  sigil: Schema.Literals(['@', '!']),
  raw: Schema.Boolean,
  direct: Schema.Boolean,
  target: Schema.NonEmptyString.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_./-]+$/))),
}) {}

export const ModifierCliFlagSchema = Schema.standardSchemaV1(ModifierProduct)

export function formatModifierToken(ast: ModifierProduct): string {
  const prefix = ast.raw ? `${ast.sigil}${ast.sigil}` : ast.sigil
  const eq = ast.direct ? '=' : ''
  return `${prefix}${eq}${ast.target}`
}

export const modifierProductArbitrary: Arbitrary.Arbitrary<ModifierProduct> = Arbitrary.schema(ModifierProduct)

export * as ModifierSlice from './example-schema-slice.ts'
```

---

# Part III. Algebraic Effects, Decentralized Inferred Ports & Ambient Fiber Context

## 1. Theoretical Foundation: Native `Effect<A, E, R>`, Inferred `Context.Service` & `Context.Reference`

Never implement custom generator trampolines (`perform`/`handle`) or monolithic kernel driver files (`drivers.ts`) when `Effect` v4 is in the stack:

- **Decentralized Feature Ports with Inferred Shapes (OpenCode v2 / Effect v4 `{ make }` Idiom):** The kernel must never define a monolithic OS driver interface knowing about files, shells, globs, or clipboards. Instead, each vertical feature declares its own `Context.Service` using the `{ make }` factory option (or `ReturnType<typeof makeLivePort>`) and exposes its live layer lazily via `Layer.unwrap`, so unused feature ports are never initialized at runtime. Consumers reference the service shape via `PortClass['Service']` without `export interface` or `export type`.
- **Single-Responsibility Library Mapping (<= 5 LoC per Port):**
- `ShellPort` wraps `nano-spawn` (`spawn(cmd, { cwd, timeout })`).
- `GlobPort` wraps `tinyglobby` (`glob`) + `ignore` (`.checkIgnore()`).
- `MarkdownPort` wraps `unjs/md4x` via `md4x/standalone` (`await init()` once inside `Layer.unwrap`, exposing `renderToAnsi`, `heal`, `parseAST`, `parseYAML`).
- `LinkPort` wraps `linkify-it` (`.match()`, `.matchAtStart()`).
- `FuzzyPort` wraps `@leeoniya/ufuzzy` (`uf.search()`).
- `SplicePort` wraps `magic-string` (`overwrite`, `prependLeft`, `appendRight`) + `multi-integer-range` (`parse`, `append`, `subtract`, `has`).
- `TelemetryHudPort` wraps `unjs/hookable` (`HookableCore`), `@clack/prompts`, and `unjs/std-env` (`isAgent`, `isCI`, `hasTTY`).

- **Ambient Execution Context (Zero Context Threading):** Dynamic execution state such as `correlationId`, `scopeDir`, `rootDir`, or `depth` must **never** be copied into AST/DTO nodes or threaded through function parameters. Store them in an **Ambient Context Reference (`Context.Reference`)** backed by a `Schema.Class` and scope changes locally via `Effect.provideService`.

```ts
/*
 * Declares an ambient fiber-local execution context and an Effect v4 service
 * inferred directly from its make factory with zero interface or type exports.
 */
import { Context, Effect, Layer, Schema } from 'effect'

export class ExecutionContextShape extends Schema.Class<ExecutionContextShape>('kernel/ExecutionContextShape')({
  correlationId: Schema.String,
  scopeDir: Schema.String,
  rootDir: Schema.String,
  depth: Schema.Int,
}) {}

export class ExecutionContext extends Context.Reference<ExecutionContext>()('kernel/ExecutionContext', {
  defaultValue: (): ExecutionContextShape =>
    new ExecutionContextShape({
      correlationId: 'root',
      scopeDir: '/',
      rootDir: '/',
      depth: 0,
    }),
}) {}

export const withNestedScopeDir = <A, E, R>(nextDir: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const current = yield* ExecutionContext
    return yield* Effect.provideService(
      effect,
      ExecutionContext,
      new ExecutionContextShape({
        ...current,
        scopeDir: nextDir,
        depth: current.depth + 1,
      }),
    )
  })

export const makeLiveClockPort = () => ({
  nowMs: (): Effect.Effect<number> => Effect.sync(() => performance.now()),
})

export class ClockPort extends Context.Service<ClockPort, ReturnType<typeof makeLiveClockPort>>()('feature/ClockPort') {
  static readonly Live: Layer.Layer<ClockPort> = Layer.unwrap(
    Effect.sync(() => Layer.succeed(ClockPort, makeLiveClockPort())),
  )
}

export * as AmbientExecution from './execution-context.ts'
```

---

# Part IV. Hybrid Initial–Final Pipeline: Comonadic IR Reification & Tagless `Effect` Lowering

## 1. Reify-to-Inspect, Lower-to-Execute (Domain-Blind Scheduling)

To solve the Expression Problem and support multi-pass static inspection (such as algebraic interval widening, cross-node deduplication, dry-run skeleton emission, and telemetry) alongside concurrent execution:

1. **Initial Reification Pass (Pure Comonadic IR):** Feature recognizers inspect inputs outside subtracted code-fence ranges (`mr.subtract`) and emit a collection of `Annotated<Meta, DomainNode>`. Each feature defines its own execution scheduling trait (`concurrency: 'parallel' | 'sequential'`) on its descriptor rather than hardcoding domain kind checks (`kind === 'shell'`) inside the kernel.
2. **Whole-Graph Algebraic Passes (Pure Endomorphisms over `Annotated[]`):** Cross-cutting features (such as two-pass canonical interval-widening deduplication via `multi-integer-range` `mr.append` / `mr.has` or idempotence normalization) operate as pure algebraic functions `readonly Annotated<Meta, DomainNode>[] -> readonly Annotated<Meta, DomainNode>[]` before any effectful I/O occurs.
3. **Final Tagless Lowering (`DomainNode -> Effect<EvaluatedNode, E, R>`):** Each vertical feature registers its interpreter clause lowering its semantic node into an `Effect` fiber. The kernel partitions nodes strictly by their generic scheduling trait (`parallel` via `Effect.all(..., { concurrency: 'unbounded' })` vs. `sequential` fold), mutates positions via `magic-string`, and applies comonadic envelopes and resource quotas uniformly.

---

# Part V. Separate Compilation (`--isolatedDeclarations`), Virtual Feature Discovery & Zero-Dependency Bundling

1. **Strict Type-Stripping Compatibility (Node 26 LTS + TS 7):** Enforce `isolatedDeclarations: true`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, and `typescript/no-explicit-any: 'error'`. Non-erasable constructs (`enum`, runtime `namespace`, parameter properties), type-only imports/exports (`import type`, `export type`, `export interface`), and unsafe casts (`as unknown as`) are strictly banned.
2. **Surgical Bundling & Compile-Time Feature Discovery (`tsdown` + Rolldown + Oxc):** Configure `tsdown.config.ts` with `treeshake: { moduleSideEffects: false }`, `deps: { alwaysBundle: [/.*/], onlyBundle: false }`, `dts: { generator: 'oxc' }`, and a lightweight Rolldown virtual module plugin (`virtual:ahead-features`) using `tinyglobby` so adding a feature file in `src/features/*.ts` requires zero edits to any other file while keeping unused features 100% tree-shakeable.

```ts
/*
 * Configures zero-dependency surgical bundling, Oxc isolated declaration emit,
 * and compile-time feature discovery via a Rolldown virtual module plugin.
 */
import { globSync } from 'tinyglobby'
import { defineConfig } from 'tsdown'

const VIRTUAL_ID = 'virtual:ahead-features'
const RESOLVED_ID = '\0virtual:ahead-features'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'es2026',
  dts: { generator: 'oxc' },
  treeshake: {
    moduleSideEffects: false,
  },
  deps: {
    alwaysBundle: [/.*/],
    onlyBundle: false,
  },
  plugins: [
    {
      name: 'ahead-feature-discovery',
      resolveId(id: string): string | null {
        return id === VIRTUAL_ID ? RESOLVED_ID : null
      },
      load(id: string): string | null {
        if (id !== RESOLVED_ID) return null
        const files = globSync('src/features/*.ts').sort()
        const imports = files.map((file, idx) => `import { feature as f${idx} } from './${file}'`).join('\n')
        const tuple = files.map((_, idx) => `f${idx}`).join(', ')
        return `${imports}\nexport const discoveredFeatures = /* @__PURE__ */ Object.freeze([${tuple}] as const)\n`
      },
    },
  ],
})
```

---

# Part VI. Syntax-Agnostic Algebraic Law Verification (`effect/Arbitrary` & `@effect/vitest`)

## 1. Zero-Test-Code in Features & Zero Hardcoded Syntax in Tests

- **Zero Test Hooks in Features:** Feature modules must contain **zero test-specific hooks or mocks**.
- **Zero Hardcoded Syntax & Zero Feature Imports by Name in Tests:** Test files must **never** hardcode concrete syntax tokens or sigils (such as `@##`, `@@`, or `:1-2`) and must **never** import individual files from `src/features/*` by name. Instead, the universal Law Runner loads the auto-discovered feature tuple (`discoveredFeatures`) and introspects each feature's declarative `syntaxCodec` to synthesize and print valid syntax dynamically. If a feature's syntax changes inside its module, or a new feature file is dropped into `src/features/`, the entire test suite adapts automatically without editing a single line in `tests/`.

---

## 2. Theoretical Foundation (Peer-Reviewed Literature)

- **Taxonomy of Universal Properties (John Hughes, _"How to Specify It! A Guide to Writing Properties of Pure Functions"_, TFP 2019 / Springer LNCS 12053, pp. 58–83):** Eliminates fragile hand-written example tests by verifying five universal classes of properties across generated inputs:

1. **Invariants (Validity Laws):** Structural guarantees that hold for any output (e.g., comonadic span conservation, quota conservation `head + tail + hidden === total`).
2. **Postconditions & Round-Trip Laws:** Codec inversion laws verifying that parsing and printing of command ASTs are partial isomorphisms:

$$\forall x,\quad \text{decode}(\text{encode}(x)) \approx x$$

3. **Metamorphic Properties & Equivalence Preservation:** Predictable relationships between outputs when transforming the input—including idempotence ($f(f(x)) \equiv f(x)$), comment/escape annihilation, and raw/wrapped/ghost inclusion—verified without knowing the exact output value in advance:

$$\forall x,\quad f(\text{transform}(x)) \sim g(f(x))$$

4. **Inductive Properties:** Verifying that composed feature operators preserve non-interference across surrounding context.
5. **Model-Based Properties (Homomorphism Laws):** Commuting diagrams verifying that effectful operations over a virtual `Layer` match a pure reference model.

- **Invertible Syntax & Partial Isomorphisms (Tillmann Rendel & Klaus Ostermann, _"Invertible Syntax Descriptions: Unifying Parsing and Pretty Printing"_, ACM SIGPLAN Haskell Symposium 2010):** Binding concrete syntax (`Encoded`) and abstract domain payloads (`Type`) in a single declarative specification simultaneously drives parsing, rendering, and syntax-agnostic test-case synthesis.

---

## 3. Reference Pattern: Syntax-Agnostic Law Runner via `effect/Arbitrary` & `@effect/vitest`

```ts
/*
 * Verifies universal comonadic and round-trip codec laws across all discovered
 * features dynamically without importing feature files by name or using import type.
 */
import { expect, it } from '@effect/vitest'
import { Arbitrary, Effect, Schema } from 'effect'
import { discoveredFeatures } from 'virtual:ahead-features'
import { Annotated, extractAnnotated, mapAnnotated } from '../src/kernel/ahead.ts'

const ProseEnvelopeSchema = Schema.Struct({
  leftProse: Schema.NonEmptyString.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,12}$/))),
  rightProse: Schema.NonEmptyString.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,12}$/))),
})

it.effect('verifies syntax-agnostic codec isomorphism and comonadic functor laws for all features', () =>
  Effect.gen(function* () {
    for (const feature of discoveredFeatures) {
      const codec = feature.syntaxCodec
      const encodeToken = Schema.encodeSync(codec)
      const decodeToken = Schema.decodeUnknownSync(codec)
      const caseArb = Arbitrary.all([Arbitrary.schema(ProseEnvelopeSchema), Arbitrary.schema(codec)])

      const check = yield* Arbitrary.checkEffect(
        caseArb,
        ([{ leftProse, rightProse }, tokenAst]) =>
          Effect.sync(() => {
            const synthesizedToken = String(encodeToken(tokenAst))
            const roundTripAst = decodeToken(synthesizedToken)
            const line = `${leftProse} ${synthesizedToken} ${rightProse}`
            const node = new Annotated({ lineLength: line.length }, synthesizedToken)
            const upper = mapAnnotated(node, (s) => s.toUpperCase())
            return (
              JSON.stringify(roundTripAst) === JSON.stringify(tokenAst) &&
              extractAnnotated(upper) === synthesizedToken.toUpperCase() &&
              upper.meta.lineLength === line.length
            )
          }),
        { runs: 100, seed: 42 },
      )
      expect(Arbitrary.formatCheckFailure(check)).toBeUndefined()
    }
  }),
)
```
