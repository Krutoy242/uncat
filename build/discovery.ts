/*
 * Compile-time discovery of the feature folder, shared by the bundler, the
 * test runner and the development loader, so that dropping one module into
 * that folder is the only step needed to extend the program family.
 */
import { globSync } from 'tinyglobby'

export const VIRTUAL_ID = 'virtual:ahead-features'

const RESOLVED_ID = `\0${VIRTUAL_ID}`

export const featureFiles = (root: string): ReadonlyArray<string> =>
  globSync('src/features/*.ts', { cwd: root, absolute: true }).toSorted()

export const featureModule = (files: ReadonlyArray<string>, specifier: (file: string) => string): string => {
  const imports = files.map((file, index) => `import { feature as f${index} } from ${JSON.stringify(specifier(file))}`)
  const tuple = files.map((_, index) => `f${index}`).join(', ')
  return `${imports.join('\n')}\nexport const discoveredFeatures = /* @__PURE__ */ Object.freeze([${tuple}])\n`
}

export const aheadFeatures = (
  root: string = process.cwd(),
): {
  readonly name: string
  readonly resolveId: (id: string) => string | null
  readonly load: (id: string) => string | null
} => ({
  name: 'ahead-feature-discovery',
  resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
  load: (id) => (id === RESOLVED_ID ? featureModule(featureFiles(root), (file) => file) : null),
})
