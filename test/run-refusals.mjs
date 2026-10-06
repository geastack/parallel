#!/usr/bin/env node
// Compiles every program under test/refusals and requires geatsc to refuse it
// with a `parallel-region` refusal whose reason contains the file's
// `// expect:` text, and every program under test/fixtures to certify.
//
//   node test/run-refusals.mjs [name...]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '@geastack/compiler/dist/compiler.js'
import { loadCliPlugins } from '@geastack/compiler/dist/plugins/load.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const plugins = await loadCliPlugins([path.join(root, 'plugin/index.mjs')])
const project = path.join(root, 'test/tsconfig.json')
const requested = process.argv.slice(2)
const listed = (dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((file) => file.endsWith('.ts') && (requested.length === 0 || requested.includes(file.slice(0, -3))))
    .sort()
    .map((file) => path.join(root, dir, file))

let failures = 0
const regionRefusals = (file) => {
  const result = compile({ rootFileNames: [file], projectFileName: project, plugins })
  return { result, refusals: result.refusals.filter((refusal) => refusal.key.startsWith('parallel-region')) }
}

for (const file of listed('test/refusals')) {
  const expected = /^\/\/ expect: (.*)$/m.exec(fs.readFileSync(file, 'utf8'))?.[1]
  const { result, refusals } = regionRefusals(file)
  const matched = expected !== undefined && refusals.some((refusal) => refusal.reason.includes(expected))
  if (matched && !result.certificate)
    console.log(`ok   refused ${path.basename(file)}: ${refusals[0].reason.replace(process.cwd() + '/', '')}`)
  else {
    failures++
    console.log(`FAIL ${path.basename(file)}: expected a refusal containing "${expected}"`)
    for (const refusal of refusals) console.log(`       ${refusal.owner}: ${refusal.reason}`)
    if (refusals.length === 0)
      console.log(
        `       certified: ${Boolean(result.certificate)}; other refusals: ${result.refusals
          .slice(0, 3)
          .map((r) => `${r.key} ${r.reason}`)
          .join(' | ')}`
      )
  }
}

for (const file of listed('test/fixtures')) {
  const { result, refusals } = regionRefusals(file)
  if (result.certificate && refusals.length === 0) console.log(`ok   certified ${path.basename(file)}`)
  else {
    failures++
    console.log(`FAIL ${path.basename(file)} was not certified`)
    for (const refusal of (refusals.length ? refusals : result.refusals).slice(0, 10))
      console.log(`       ${refusal.key} ${refusal.owner}: ${refusal.reason}`)
  }
}
process.exit(failures === 0 ? 0 : 1)
