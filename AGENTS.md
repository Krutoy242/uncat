## Architectural Invariants

- **1 Feature / 1 Fix = 1 Autonomous File**: Each capability, syntax rule, or CLI/API option must encapsulate its own active schema, bidirectional syntax codec, lazy effect port (`Layer.unwrap`), and execution logic in one vertical file auto-discovered via a tree-shakeable (`/* @__PURE__ */`) virtual module.

  > - ❌ Forbidden: importing feature implementation files by name anywhere.
  > - 🤔 Given-When-Then: Add one feature -> add single file (no other changes, unused features are tree-shaken).

- **Domain-Blind Microkernel**: The core kernel may define only generic pipeline slots, comonadic lifters, and open execution traits (such as parallel vs. sequential scheduling flags).

  > - ❌ Forbidden: Hardcoding domain token names, wrapper tags, or monolithic OS driver interfaces inside the kernel.
  > - 🤔 Given-When-Then: kernel source code can be moved to another project that is not related to text mutation without edits.

- **Declarative Codecs & Inferred Ports (Zero Boilerplate)**: Use declarative grammar tables, product combinators, comonadic span lifting, and ambient fiber context (`Context.Reference`). Rely on dual-space value-level idioms (`Schema.Class`, `Schema.TaggedError`, `Context.Service` `{ make }`, `typeof`, and `export * as`) so runtime values carry static types directly.

  > - ❌ Forbidden: type duplications, `any`, `import type`, `export type`, `export interface`.
  > - 🤔 Given-When-Then: zero `import type` or `export type`/`interface` in feature files under `verbatimModuleSyntax` and `isolatedDeclarations`.

- **Library-First & Bleeding-Edge Only**: Abuse specialized stack libraries directly (`<= 5` LoC per call, no overlapping wrappers) for effects, Standard Schema CLI validation, parsing, and inlined-WASM rendering (`md4x/standalone`), bundled into a zero-dependency artifact (`deps.alwaysBundle`). Every declared schema and dependency must actively drive runtime execution.

  > - ❌ Forbidden: dead or ornamental schemas, redundant custom wrappers over stack libraries.
  > - 🤔 Given-When-Then: `pnpm update -r` -> no changes.

- **Syntax-Agnostic Law Testing**: Verify all Manifesto invariants via a universal Property-Based & Metamorphic Law runner that introspects each auto-discovered feature's reversible command AST `syntaxCodec` for round-trip isomorphism and tests irreversible interpreters via metamorphic laws.

  > - ❌ Forbidden: hardcoding concrete domain sigils or importing feature files by name inside test files.
  > - 🤔 Given-When-Then: Replaced comment regex only in feature file -> tests still green.

## Stack and CI

- **Stack**: `pnpm`, `Effect-TS`, `@effect/vitest`, `privatenumber/cleye`, `unjs/std-env`, `linkify-it`, `unjs/hookable`, `magic-string`, `unjs/md4x` (`md4x/standalone`), `tinyglobby`, `ignore`, `multi-integer-range`, `@clack/prompts`, `nano-spawn`, `@leeoniya/ufuzzy`, `tsdown`, `vitest`, `oxlint` (`oxlint-tsgolint`)
- **CI**: npm publish, automated SVG demo generation based on real cli call (`bat` → `uncat` → result)

## Map of the code

- `src/kernel/` — portable microkernel: comonadic `Annotated` envelope, AHEAD synthesizer with design-rule checks, ambient fiber frame, trait-partitioned scheduler. Imports nothing but `effect`.
- `src/program/` — the text-expansion program family: dual-space carriers, invertible grammar product, the slot record with its inert base, the reify → lower → render engine, the synthesis equation and the shared run service.
- `src/features/` — one file per capability; each exports exactly `feature` and is reached only through `virtual:ahead-features`.
- `build/discovery.ts` — the compile-time discovery used by tsdown, vitest and the development loader alike.
- `tests/` — syntax-agnostic law runner, kernel laws and architecture invariants.

## Toolchain notes

- TypeScript 7.0 accepts targets up to `es2025`; `es2026` arrives with 7.1, so the compiler target is `es2025` while the bundle targets `node26`.
- `isolatedDeclarations` rejects call expressions in exported `extends` clauses, so `Schema.Class`, `Schema.TaggedError` and `Context.Service` classes stay module-private and cross-module contracts are `Data.Class` carriers, which are still values that carry their own types.
- Checks: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (`pnpm check`).
