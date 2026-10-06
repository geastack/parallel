import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inertPluginInstance } from '@geastack/compiler/plugin'

// `@geastack/parallel/native` is implemented by the compiler's region runtime
// (`gea::parallel::tasks` in gea_runtime.h), not by its JavaScript, which is
// the sequential reference Node runs. Its functions are claimed by their
// declaration file, so a program that declares its own `tasks` is never
// mistaken for this one.
//
// The preamble turns the region runtime on for the whole program: every unit
// includes the one runtime header the preambles belong to, so the reference
// counts are hooked the same way in all of them.
const declarationFile = fileURLToPath(new URL('../native/index.d.ts', import.meta.url))
const spellings = [...new Set([declarationFile, path.resolve(declarationFile), fs.realpathSync(declarationFile)])]
const functions = new Map([['tasks', 'gea::parallel::tasks']])

export function geatscPlugin() {
  return {
    name: 'parallel',
    instantiate() {
      return {
        ...inertPluginInstance,
        capabilities: {
          ...inertPluginInstance.capabilities,
          declarationModules: new Set(['@geastack/parallel/native']),
          hostFunctionsByDeclaration: new Map(spellings.map((file) => [file, functions])),
          hostPreambles: new Map([['gea::parallel::tasks', ['#define GEA_RUNTIME_PARALLEL 1']]]),
          parallelRegionEntries: new Set(['gea::parallel::tasks'])
        }
      }
    }
  }
}

export default geatscPlugin
