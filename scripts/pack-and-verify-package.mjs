#!/usr/bin/env node

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
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

export function assertSdkDeviceArtifact(deviceJs, deviceDts) {
  const forbiddenRuntime = [
    ['Node builtin', /(?:from\s+|import\s*)["']node:/],
    ['process.env', /\bprocess\.env\b/],
    ['Node ws package', /(?:from\s+|import\s*)["']ws["']/],
    ['private workspace package', /["']@tool-bridge\/(?:app|core)(?:\/[^"']*)?["']/],
    ['Hono', /(?:from\s+|import\s*)["']hono(?:\/[^"']*)?["']/],
  ]
  for (const [label, pattern] of forbiddenRuntime) {
    if (pattern.test(deviceJs)) throw new Error(`sdk device artifact contains ${label}`)
  }
  if (/\b(?:NodeJS|Buffer)\b/.test(deviceDts)) {
    throw new Error('sdk device declarations contain Node-only types')
  }
  if (/@tool-bridge\/(?:app|core)/.test(deviceDts)) {
    throw new Error('sdk device declarations reference a private workspace package')
  }

  const externalImports = [
    ...deviceJs.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...deviceJs.matchAll(/\bimport\s+["']([^"']+)["']/g),
  ].map(match => match[1]).filter(Boolean)
  const unexpected = externalImports.filter(specifier =>
    specifier !== 'partysocket/ws' && !specifier.startsWith('./'))
  if (unexpected.length > 0) {
    throw new Error(`sdk device artifact has unexpected imports: ${unexpected.join(', ')}`)
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
  const deviceJs = await readPackedFile(tarballPath, 'package/dist/device.js')
  const deviceDts = await readPackedFile(tarballPath, 'package/dist/device.d.ts')
  assertSdkDeviceArtifact(deviceJs, deviceDts)
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
        + 'if(typeof root.createToolBridge!==\'function\'||typeof device.connectDevice!==\'function\')'
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
