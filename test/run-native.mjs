#!/usr/bin/env node
// Runs every fixture under Node (the reference), compiles it with geatsc, and
// builds and runs the C++: an optimized build at one thread and at every
// thread, and ThreadSanitizer and AddressSanitizer builds. Each run's stdout
// must equal Node's.
//
//   node test/run-native.mjs [fixture...] [--host=dashwin-geastack] [--no-sanitizers]
//
// The C++ build runs remotely (GEA_PARALLEL_HOST, default `dashwin-geastack`,
// reached as `ssh <host> 'wsl -d Ubuntu-24.04 -- bash -s'`), or on this machine
// with --host=local and clang++ (on Windows, LLVM_ROOT or the LLVM install
// directory when clang++ is not on PATH). clang has no ThreadSanitizer on
// Windows, so a local Windows run builds the other variants and says so.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const compilerCli = path.join(root, 'node_modules/@geastack/compiler/dist/cli.js')
const argv = process.argv.slice(2)
const option = (name, fallback) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const host = option('host', process.env.GEA_PARALLEL_HOST ?? 'dashwin-geastack')
const local = host === 'local'
const windows = local && process.platform === 'win32'
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
// The reference run. Node versions that still have --experimental-transform-types
// run a fixture's TypeScript directly; later ones only strip types, which
// refuses the parameter properties the fixtures use, and reject the flag as a
// bad option. There the fixture is transpiled with the package's TypeScript
// into build/, inside this package, so `@geastack/parallel` still resolves.
const transformTypes = process.allowedNodeEnvironmentFlags.has('--experimental-transform-types')
function reference(fixture, source) {
  if (transformTypes) return run(process.execPath, ['--experimental-transform-types', '--no-warnings', source], { cwd: root })
  const ts = createRequire(import.meta.url)('typescript')
  const { outputText } = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: source
  })
  const script = path.join(root, 'build', `${fixture}.reference.mjs`)
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(script, outputText)
  return run(process.execPath, ['--no-warnings', script], { cwd: root })
}

function remote(script) {
  return run('ssh', [host, 'wsl -d Ubuntu-24.04 -- bash -s'], { input: script })
}

function ship(directories) {
  const tar = run('tar', ['czf', '-', '--no-xattrs', ...directories], {
    cwd: root,
    encoding: 'buffer',
    env: { ...process.env, COPYFILE_DISABLE: '1' }
  })
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`)
  const unpack = spawnSync(
    'ssh',
    [host, 'wsl -d Ubuntu-24.04 -- bash -c "mkdir -p ~/geastack/parallel && cd ~/geastack/parallel && tar xzf - 2>/dev/null"'],
    {
      input: tar.stdout
    }
  )
  if (unpack.status !== 0) throw new Error(`unpack failed: ${unpack.stderr}`)
}

// The LLVM installer does not put clang++ on PATH on Windows.
const clang = () => {
  if (!windows) return 'clang++'
  const roots = [process.env.LLVM_ROOT, path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LLVM')].filter(Boolean)
  const onPath = (process.env.PATH ?? '').split(path.delimiter).find((d) => d && fs.existsSync(path.join(d, 'clang++.exe')))
  const found = [...roots.slice(0, 1), onPath && path.dirname(onPath), ...roots.slice(1)]
    .filter(Boolean)
    .map((r) => path.join(r, 'bin', 'clang++.exe'))
    .find((file) => fs.existsSync(file))
  return found ?? 'clang++'
}

const variants = [
  { name: 'release', flags: ['-O2', '-DNDEBUG'], runs: [{ threads: '1' }, { threads: '' }] },
  ...(sanitizers
    ? [
        ...(windows ? [] : [{ name: 'tsan', flags: ['-O1', '-g', '-fsanitize=thread'], runs: [{ threads: '' }], env: { TSAN_OPTIONS: 'halt_on_error=1' } }]),
        {
          name: 'asan',
          flags: ['-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=undefined'],
          runs: [{ threads: '' }],
          env: { ASAN_OPTIONS: 'detect_leaks=0' }
        }
      ]
    : [])
]
if (windows && sanitizers) console.log('note: no ThreadSanitizer build on Windows (clang does not support it there)')

// Builds and runs every variant on this machine, as the same sections the
// remote script prints: `=== <variant> threads=<n>`, the output, `=== exit <status>`.
function buildLocally(outDir, unit) {
  const cxx = clang()
  const sections = []
  for (const variant of variants) {
    const binary = path.join(outDir, windows ? `${variant.name}.exe` : variant.name)
    const build = run(
      cxx,
      ['-std=gnu++20', ...variant.flags, ...(windows ? [] : ['-pthread']), ...unit, path.join(root, 'test/support/main.cpp'), '-o', binary],
      { cwd: outDir }
    )
    if (build.status !== 0) {
      const log = `${build.error ?? ''}${build.stdout ?? ''}${build.stderr ?? ''}`
      sections.push(`=== ${variant.name} build-failed\n${log.split('\n').slice(-30).join('\n')}\n`)
      continue
    }
    for (const r of variant.runs) {
      const env = { ...process.env, ...variant.env, ...(r.threads ? { GEA_PARALLEL_THREADS: r.threads } : {}) }
      const ran = run(binary, [], { cwd: outDir, env, timeout: 300_000 })
      // Windows opens a C++ program's stdout in text mode: its `\n` arrives as `\r\n`.
      const output = `${ran.stdout ?? ''}${ran.stderr ?? ''}`.replaceAll('\r\n', '\n')
      sections.push(`=== ${variant.name} threads=${r.threads || 'all'}\n${output}=== exit ${ran.status ?? ran.signal ?? ran.error}\n`)
    }
  }
  return { stdout: sections.join(''), stderr: '' }
}

let failures = 0
for (const fixture of fixtures) {
  const source = path.join(fixturesDir, `${fixture}.ts`)
  const node = reference(fixture, source)
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
  const unit = fs.readdirSync(outDir).filter((f) => f.endsWith('.cpp') && f !== 'gea_runtime_builtins.cpp')
  let result
  if (local) result = buildLocally(outDir, unit)
  else {
    ship([`build/${fixture}`, 'test/support'])
    const script = [`set -u`, `cd ~/geastack/parallel/build/${fixture}`]
    for (const variant of variants) {
      const env = Object.entries(variant.env ?? {}).map(([name, value]) => `${name}=${value}`)
      script.push(
        `if clang++ -std=gnu++20 ${variant.flags.join(' ')} -pthread ${unit.join(' ')} ../../test/support/main.cpp -o ${variant.name} > ${variant.name}.build.log 2>&1; then`,
        ...variant.runs.map(
          (r) =>
            `  echo "=== ${variant.name} threads=${r.threads || 'all'}"; env ${env.join(' ')} ${r.threads ? `GEA_PARALLEL_THREADS=${r.threads}` : ''} timeout 300 ./${variant.name} 2>&1; echo "=== exit $?"`
        ),
        `else echo "=== ${variant.name} build-failed"; tail -30 ${variant.name}.build.log; fi`
      )
    }
    result = remote(script.join('\n'))
  }
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
