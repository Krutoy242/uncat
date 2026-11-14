/*
 * Development loader hook that lets plain Node run the TypeScript sources
 * directly by answering the virtual feature module with the same discovery
 * the bundler uses, keeping unbundled runs faithful to the shipped artifact.
 */
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { VIRTUAL_ID, featureFiles, featureModule } from './discovery.ts'

const source = featureModule(featureFiles(resolve(import.meta.dirname, '..')), (file) => pathToFileURL(file).href)

registerHooks({
  resolve: (specifier, context, nextResolve) =>
    specifier === VIRTUAL_ID
      ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
      : nextResolve(specifier, context),
})
