#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, posix, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { tmpdir } from 'node:os'

const RUNTIME_DEPENDENCY_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
]

// npm 无法解析这些 workspace/package-manager 专用协议。file: 是 npm 支持的
// 本地依赖协议，因此不在这里一概拒绝。
const UNSUPPORTED_PUBLISH_PROTOCOL = /^(?:catalog|link|patch|portal|workspace):/i

export function findUnsupportedRuntimeDependencySpecs(manifest) {
  const unsupported = []

  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const dependencies = manifest[field]
    if (dependencies === undefined) continue
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new TypeError(`packed manifest ${field} must be an object`)
    }

    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec === 'string' && UNSUPPORTED_PUBLISH_PROTOCOL.test(spec)) {
        unsupported.push({ field, name, spec })
      }
    }
  }

  return unsupported
}

export function assertNoUnsupportedRuntimeDependencySpecs(manifest) {
  const unsupported = findUnsupportedRuntimeDependencySpecs(manifest)
  if (unsupported.length === 0) return

  const details = unsupported
    .map(({ field, name, spec }) => `${field}.${name}=${JSON.stringify(spec)}`)
    .join(', ')
  throw new Error(`packed manifest contains unsupported dependency protocols: ${details}`)
}

function collectConditionalTargets(value, targets) {
  if (typeof value === 'string') {
    if (value.startsWith('./')) targets.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectConditionalTargets(entry, targets)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) collectConditionalTargets(entry, targets)
  }
}

export function collectPackedEntryTargets(manifest) {
  const targets = new Set()
  collectConditionalTargets(manifest.main, targets)
  collectConditionalTargets(manifest.module, targets)
  collectConditionalTargets(manifest.types, targets)
  collectConditionalTargets(manifest.exports, targets)
  collectConditionalTargets(manifest.bin, targets)
  // Dashboard 是静态站点包，没有 JS library export；index.html 就是公开入口。
  if (manifest.name === '@tool-bridge/dashboard') targets.add('./dist/index.html')
  return [...targets].sort()
}

export function assertPackedEntryTargetsExist(manifest, packedFiles) {
  const missing = collectPackedEntryTargets(manifest)
    .map(target => `package/${target.slice(2)}`)
    .filter(target => !packedFiles.has(target))
  if (missing.length > 0) {
    throw new Error(`packed manifest points to missing files: ${missing.join(', ')}`)
  }
}

function collectExternalImports(source) {
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map(match => match[1]).filter(Boolean)
}

/**
 * 从一个 neutral entry 递归收集其相对 import 闭包。声明文件由 tsup 以 `.js`
 * specifier 指向同名 `.d.ts`，因此 declaration 模式会做一次显式映射。
 */
export function collectModuleClosure(entry, sources, declaration = false) {
  const visited = new Set()
  const pending = [entry]

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue
    const source = sources.get(current)
    if (source === undefined) throw new Error(`packed module closure is missing ${current}`)
    visited.add(current)

    for (const specifier of collectExternalImports(source)) {
      if (!specifier.startsWith('.')) continue
      let target = posix.normalize(posix.join(posix.dirname(current), specifier))
      if (declaration && target.endsWith('.js')) target = `${target.slice(0, -3)}.d.ts`
      if (!sources.has(target)) {
        throw new Error(`${current} references missing packed module ${target}`)
      }
      pending.push(target)
    }
  }

  return [...visited].sort().map(path => sources.get(path)).join('\n')
}

function assertSdkNeutralArtifact(label, runtimeJs, declarations, allowedExternalImports) {
  const forbiddenRuntime = [
    ['Node builtin', /\brequire\s*\(\s*["']node:/],
    ['process.env', /\bprocess\.env\b/],
  ]
  for (const [boundaryLabel, pattern] of forbiddenRuntime) {
    if (pattern.test(runtimeJs)) {
      throw new Error(`sdk ${label} artifact contains ${boundaryLabel}`)
    }
  }
  if (/\b(?:NodeJS|Buffer)\b|reference\s+types=["']node["']/.test(declarations)) {
    throw new Error(`sdk ${label} declarations contain Node-only types`)
  }
  if (/@tool-bridge\/(?:app|core)/.test(declarations)) {
    throw new Error(`sdk ${label} declarations reference a private workspace package`)
  }
  if (/\bfrom\s+["']hono(?:\/[^"']*)?["']/.test(declarations)) {
    throw new Error(`sdk ${label} declarations reference Hono`)
  }

  const externalImports = collectExternalImports(runtimeJs)
  if (externalImports.some(specifier => specifier.startsWith('node:'))) {
    throw new Error(`sdk ${label} artifact contains Node builtin`)
  }
  if (externalImports.includes('ws')) {
    throw new Error(`sdk ${label} artifact contains Node ws package`)
  }
  if (externalImports.some(specifier => /^@tool-bridge\/(?:app|core)(?:\/|$)/.test(specifier))) {
    throw new Error(`sdk ${label} artifact contains private workspace package`)
  }
  if (externalImports.some(specifier => /^hono(?:\/|$)/.test(specifier))) {
    throw new Error(`sdk ${label} artifact contains Hono`)
  }
  const unexpected = externalImports.filter(specifier =>
    !allowedExternalImports.has(specifier) && !specifier.startsWith('./'))
  if (unexpected.length > 0) {
    throw new Error(`sdk ${label} artifact has unexpected imports: ${unexpected.join(', ')}`)
  }
}

export function assertSdkDeviceArtifact(deviceJs, deviceDts) {
  assertSdkNeutralArtifact('device', deviceJs, deviceDts, new Set(['partysocket/ws']))
}

export function assertSdkStoreArtifact(storeJs, storeDts) {
  // Core errors and Zod wire parsers are bundled; Store has no runtime external imports.
  assertSdkNeutralArtifact('store', storeJs, storeDts, new Set())
}

export function assertSdkClientArtifact(clientJs, clientDts) {
  // Fixed-control schemas and Zod are bundled; declarations expose plain wire types only.
  assertSdkNeutralArtifact('client', clientJs, clientDts, new Set())
  const declarations = clientDts
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  if (/\bZod[A-Za-z]*\b|from\s+["'](?:zod|\.\/v4\/)/.test(declarations)) {
    throw new Error('sdk client declarations expose Zod implementation types')
  }
}

export function parseCliArguments(argv) {
  let bin
  let outputDir
  let packageDir
  let skipInstall = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--bin' || argument === '--output-dir') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value`)
      }
      if (argument === '--bin') {
        if (bin !== undefined) throw new Error('--bin may only be specified once')
        bin = value
      } else {
        if (outputDir !== undefined) throw new Error('--output-dir may only be specified once')
        outputDir = value
      }
      index += 1
    } else if (argument === '--skip-install') {
      if (skipInstall) throw new Error('--skip-install may only be specified once')
      skipInstall = true
    } else if (argument.startsWith('-')) {
      throw new Error(`unknown option: ${argument}`)
    } else if (packageDir === undefined) {
      packageDir = argument
    } else {
      throw new Error(`unexpected positional argument: ${argument}`)
    }
  }

  if (packageDir === undefined) throw new Error('package-dir is required')
  if (outputDir === undefined) throw new Error('--output-dir is required')
  if (bin !== undefined && skipInstall) {
    throw new Error('--bin cannot be used with --skip-install')
  }

  return { bin, outputDir, packageDir, skipInstall }
}

function log(message) {
  process.stderr.write(`${message}\n`)
}

function runCommand(command, args, { logOutput = true, ...options } = {}) {
  log(`$ ${command} ${args.join(' ')}`)

  return new Promise((fulfill, reject) => {
    const child = spawn(command, args, {
      ...options,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []

    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      const stdoutText = Buffer.concat(stdout).toString('utf8')
      const stderrText = Buffer.concat(stderr).toString('utf8')
      if (logOutput && stdoutText !== '') process.stderr.write(stdoutText)
      if (stderrText !== '') process.stderr.write(stderrText)

      if (code === 0) {
        fulfill({ stderr: stderrText, stdout: stdoutText })
      } else {
        reject(new Error(`${command} exited with code ${code}`))
      }
    })
  })
}

function tarballFilename(manifest) {
  if (typeof manifest.name !== 'string' || manifest.name === '') {
    throw new Error('source package manifest must have a name')
  }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('source package manifest must have a version')
  }

  const packageName = manifest.name.replace(/^@/, '').replaceAll('/', '-')
  return `${packageName}-${manifest.version}.tgz`
}

async function readPackedManifest(tarballPath) {
  const { stdout } = await runCommand('tar', [
    '-xOf',
    tarballPath,
    'package/package.json',
  ], { logOutput: false })

  try {
    return JSON.parse(stdout)
  } catch (error) {
    throw new Error(`cannot parse package/package.json from ${tarballPath}`, { cause: error })
  }
}

async function listPackedFiles(tarballPath) {
  const { stdout } = await runCommand('tar', ['-tf', tarballPath], { logOutput: false })
  return new Set(stdout.split(/\r?\n/).filter(Boolean).map(path => path.replace(/\/$/, '')))
}

async function readPackedFile(tarballPath, path) {
  const { stdout } = await runCommand('tar', ['-xOf', tarballPath, path], { logOutput: false })
  return stdout
}

async function verifyPackedArtifacts(tarballPath, manifest) {
  const packedFiles = await listPackedFiles(tarballPath)
  assertPackedEntryTargetsExist(manifest, packedFiles)
  if (manifest.name !== '@tool-bridge/sdk') return
  const jsSources = new Map()
  const declarationSources = new Map()
  for (const path of packedFiles) {
    if (/^package\/dist\/[^/]+\.js$/.test(path)) {
      jsSources.set(path, await readPackedFile(tarballPath, path))
    } else if (/^package\/dist\/[^/]+\.d\.ts$/.test(path)) {
      declarationSources.set(path, await readPackedFile(tarballPath, path))
    }
  }
  const closure = label => ({
    declarations: collectModuleClosure(
      `package/dist/${label}.d.ts`,
      declarationSources,
      true,
    ),
    runtime: collectModuleClosure(`package/dist/${label}.js`, jsSources),
  })
  const device = closure('device')
  const client = closure('client')
  const store = closure('store')
  assertSdkDeviceArtifact(device.runtime, device.declarations)
  assertSdkClientArtifact(client.runtime, client.declarations)
  assertSdkStoreArtifact(store.runtime, store.declarations)
}

function installedBinPath(consumerDir, bin) {
  const filename = process.platform === 'win32' ? `${bin}.cmd` : bin
  return join(consumerDir, 'node_modules', '.bin', filename)
}

async function verifyConsumerInstall(tarballPath, manifest, bin) {
  const consumerDir = await mkdtemp(join(tmpdir(), 'tool-bridge-package-consumer-'))

  try {
    await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
      name: 'tool-bridge-package-consumer',
      private: true,
      version: '0.0.0',
    }))
    await runCommand('npm', [
      'install',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      tarballPath,
    ], { cwd: consumerDir })

    if (bin !== undefined) {
      const manifestBin = typeof manifest.bin === 'string'
        ? { [basename(manifest.name)]: manifest.bin }
        : manifest.bin
      if (manifestBin === null || typeof manifestBin !== 'object' || !(bin in manifestBin)) {
        throw new Error(`packed manifest does not declare bin ${JSON.stringify(bin)}`)
      }

      const binPath = installedBinPath(consumerDir, bin)
      const versionResult = await runCommand(binPath, ['--version'], { cwd: consumerDir })
      if (versionResult.stdout.trim() !== manifest.version) {
        throw new Error(
          `${bin} --version returned ${JSON.stringify(versionResult.stdout.trim())}; `
          + `expected ${JSON.stringify(manifest.version)}`,
        )
      }
      await runCommand(binPath, ['--help'], { cwd: consumerDir })
    }
    if (manifest.name === '@tool-bridge/sdk') {
      await runCommand(process.execPath, [
        '--input-type=module',
        '--eval',
        'const root=await import(\'@tool-bridge/sdk\');'
        + 'const device=await import(\'@tool-bridge/sdk/device\');'
        + 'const client=await import(\'@tool-bridge/sdk/client\');'
        + 'const store=await import(\'@tool-bridge/sdk/store\');'
        + 'if(typeof root.createToolBridge!==\'function\'||typeof device.connectDevice!==\'function\''
        + '||typeof device.openPortableDeviceConnection!==\'function\''
        + '||typeof client.createToolBridgeClient!==\'function\''
        + '||client.fixedControlPlaneOpenApi?.openapi!==\'3.1.0\''
        + '||typeof store.createStoreClient!==\'function\'||typeof store.parseStoreUri!==\'function\')'
        + 'throw new Error(\'sdk entrypoint smoke failed\')',
      ], { cwd: consumerDir })
    }
  } finally {
    await rm(consumerDir, { force: true, recursive: true })
  }
}

export async function packAndVerifyPackage({ bin, outputDir, packageDir, skipInstall = false }) {
  if (bin !== undefined && skipInstall) {
    throw new Error('--bin cannot be used with --skip-install')
  }

  const absolutePackageDir = resolve(packageDir)
  const absoluteOutputDir = resolve(outputDir)
  const sourceManifest = JSON.parse(
    await readFile(join(absolutePackageDir, 'package.json'), 'utf8'),
  )
  const tarballPath = join(absoluteOutputDir, tarballFilename(sourceManifest))

  await mkdir(absoluteOutputDir, { recursive: true })
  await runCommand('pnpm', ['pack', '--out', tarballPath], { cwd: absolutePackageDir })

  const packedManifest = await readPackedManifest(tarballPath)
  assertNoUnsupportedRuntimeDependencySpecs(packedManifest)
  await verifyPackedArtifacts(tarballPath, packedManifest)
  if (!skipInstall) await verifyConsumerInstall(tarballPath, packedManifest, bin)

  return tarballPath
}

const isMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const options = parseCliArguments(process.argv.slice(2))
    const tarballPath = await packAndVerifyPackage(options)
    process.stdout.write(`${tarballPath}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`pack-and-verify-package: ${message}\n`)
    process.exitCode = 1
  }
}
