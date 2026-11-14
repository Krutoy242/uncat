/*
 * Linter policy that enforces the architectural invariants mechanically,
 * banning escape hatches such as explicit any and type-only module syntax
 * while enabling the type-aware rules that catch dropped effects and promises.
 */
import * as Oxlint from 'oxlint'

const config: Oxlint.OxlintConfig = Oxlint.defineConfig({
  categories: { correctness: 'error', suspicious: 'error' },
  plugins: ['typescript', 'unicorn', 'oxc', 'import'],
  options: { typeAware: true, typeCheck: true },
  ignorePatterns: ['dist/**', 'node_modules/**'],
  rules: {
    'typescript/no-explicit-any': 'error',
    'typescript/no-misused-spread': 'off',
    'no-underscore-dangle': ['error', { allow: ['_tag'] }],
    'typescript/consistent-type-imports': ['error', { prefer: 'no-type-imports' }],
    'typescript/no-import-type-side-effects': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-unsafe-assignment': 'error',
    'typescript/no-unsafe-call': 'error',
    'typescript/no-unsafe-return': 'error',
    'typescript/no-unnecessary-type-assertion': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/switch-exhaustiveness-check': 'error',
  },
})

export default config
