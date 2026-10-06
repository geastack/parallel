#!/usr/bin/env node
// Runs every fixture under Node (the reference), compiles it with geatsc, and
// builds and runs the C++ on the Linux build machine: an optimized build at one
// thread and at every thread, and ThreadSanitizer and AddressSanitizer builds.
// Each run's stdout must equal Node's.
//
//   node test/run-native.mjs [fixture...] [--host=dashwin-geastack] [--no-sanitizers]
//
// The C++ build runs remotely (GEA_PARALLEL_HOST, default `dashwin-geastack`,
// reached as `ssh <host> 'wsl -d Ubuntu-24.04 -- bash -s'`), or locally with
// --host=local on a Linux machine with clang++.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const compilerCli = path.join(root, 'node_modules/@geastack/compiler/dist/cli.js')
const argv = process.argv.slice(2)
const option = (name, fallback) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const host = option('host', process.env.GEA_PARALLEL_HOST ?? 'dashwin-geastack')
const sanitizers = !argv.includes('--no-sanitizers')
const fixturesDir = path.join(root, 'test/fixtures')
const requested = argv.filter((a) => !a.startsWith('--'))
const fixtures = (
  requested.length
    ? requested
    : fs
        .readdirSync(fixturesDir)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => f.slice(0, -3))
).sort()

const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...options })

function remote(script) {
  if (host === 'local') return run('bash', ['-s'], { input: script })
  return run('ssh', [host, 'wsl -d Ubuntu-24.04 -- bash -s'], { input: script })
}

function ship(directories) {
  const tar = run('tar', ['czf', '-', '--no-xattrs', ...directories], {
    cwd: root,
    encoding: 'buffer',
    env: { ...process.env, COPYFILE_DISABLE: '1' }
  })
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`)
  if (host === 'local') return
  const unpack = spawnSync(
    'ssh',
    [host, 'wsl -d Ubuntu-24.04 -- bash -c "mkdir -p ~/geastack/parallel && cd ~/geastack/parallel && tar xzf - 2>/dev/null"'],
    {
      input: tar.stdout
    }
  )
  if (unpack.status !== 0) throw new Error(`unpack failed: ${unpack.stderr}`)
}

const variants = [
  { name: 'release', flags: '-O2 -DNDEBUG', runs: [{ threads: '1' }, { threads: '' }] },
  ...(sanitizers
    ? [
        { name: 'tsan', flags: '-O1 -g -fsanitize=thread', runs: [{ threads: '' }], env: 'TSAN_OPTIONS=halt_on_error=1' },
        {
          name: 'asan',
          flags: '-O1 -g -fsanitize=address,undefined -fno-sanitize-recover=undefined',
          runs: [{ threads: '' }],
          env: 'ASAN_OPTIONS=detect_leaks=0'
        }
      ]
    : [])
]

let failures = 0
for (const fixture of fixtures) {
  const source = path.join(fixturesDir, `${fixture}.ts`)
  const node = run(process.execPath, ['--experimental-transform-types', '--no-warnings', source], { cwd: root })
  if (node.status !== 0) {
    console.log(`FAIL ${fixture}: node exited ${node.status}\n${node.stderr}`)
    failures++
    continue
  }
  const outDir = path.join(root, 'build', fixture)
  fs.rmSync(outDir, { recursive: true, force: true })
  const emit = run(
    process.execPath,
    [
      compilerCli,
      'compile',
      source,
      '--out-dir',
      outDir,
      '--project',
      path.join(root, 'test/tsconfig.json'),
      '--plugin',
      path.join(root, 'plugin/index.mjs')
    ],
    { cwd: root }
  )
  if (emit.status !== 0) {
    console.log(`FAIL ${fixture}: geatsc refused\n${emit.stdout}${emit.stderr}`)
    failures++
    continue
  }
  ship([`build/${fixture}`, 'test/support'])
  const unit = fs.readdirSync(outDir).filter((f) => f.endsWith('.cpp') && f !== 'gea_runtime_builtins.cpp')
  const script = [`set -u`, `cd ~/geastack/parallel/build/${fixture}`]
  for (const variant of variants) {
    script.push(
      `if clang++ -std=gnu++20 ${variant.flags} -pthread ${unit.join(' ')} ../../test/support/main.cpp -o ${variant.name} > ${variant.name}.build.log 2>&1; then`,
      ...variant.runs.map(
        (r) =>
          `  echo "=== ${variant.name} threads=${r.threads || 'all'}"; env ${variant.env ?? ''} ${r.threads ? `GEA_PARALLEL_THREADS=${r.threads}` : ''} timeout 300 ./${variant.name} 2>&1; echo "=== exit $?"`
      ),
      `else echo "=== ${variant.name} build-failed"; tail -30 ${variant.name}.build.log; fi`
    )
  }
  const result = remote(script.join('\n'))
  const sections = result.stdout.split(/^=== /m).slice(1)
  const outcomes = []
  for (let i = 0; i < sections.length; i++) {
    const header = sections[i].split('\n')[0]
    if (header.startsWith('exit')) continue
    if (header.endsWith('build-failed')) {
      outcomes.push({ header, ok: false, detail: sections[i] })
      continue
    }
    const body = sections[i].slice(header.length + 1)
    const exit = sections[i + 1]?.split('\n')[0] ?? 'exit ?'
    const ok = exit === 'exit 0' && body === node.stdout
    outcomes.push({ header, ok, detail: ok ? '' : `${exit}\n--- expected\n${node.stdout}--- actual\n${body}` })
  }
  const failed = outcomes.filter((o) => !o.ok)
  if (failed.length || outcomes.length === 0) failures++
  console.log(
    `${failed.length || outcomes.length === 0 ? 'FAIL' : 'ok  '} ${fixture}: ${outcomes.map((o) => `${o.header}${o.ok ? '' : ' (failed)'}`).join(', ')}`
  )
  for (const o of failed) console.log(o.detail.split('\n').slice(0, 60).join('\n'))
  if (outcomes.length === 0) console.log(result.stdout, result.stderr)
}
process.exit(failures === 0 ? 0 : 1)
