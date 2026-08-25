import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertPackedEntryTargetsExist,
  assertSdkClientArtifact,
  assertSdkDeviceArtifact,
  assertSdkStoreArtifact,
  collectModuleClosure,
  collectPackedEntryTargets,
  findUnsupportedRuntimeDependencySpecs,
  parseCliArguments,
} from './pack-and-verify-package.mjs'
import {
  parseRequestedPackages,
  selectReleasePackages,
} from './select-release-packages.mjs'
import { npmRegistryVersionState } from './npm-registry-version.mjs'

const root = join(import.meta.dirname, '..')
const publicPackages = ['app', 'cli', 'dashboard', 'gateway', 'plugin-sdk', 'sdk', 'server']

const releasePlanFixture = {
  order: ['app', 'dashboard', 'gateway', 'server'],
  packages: [
    { pkg: 'app', deps: [], needsPublish: true },
    { pkg: 'dashboard', deps: [], needsPublish: true },
    { pkg: 'gateway', deps: [], needsPublish: true },
    { pkg: 'server', deps: ['dashboard'], needsPublish: true },
  ],
}

test('release package selection closes pending prerequisites in topological order', () => {
  assert.deepEqual(parseRequestedPackages(' server,server , gateway '), ['server', 'gateway'])
  assert.deepEqual(selectReleasePackages(releasePlanFixture, ''), releasePlanFixture.order)
  assert.deepEqual(selectReleasePackages(releasePlanFixture, 'server'), ['dashboard', 'server'])
  assert.deepEqual(
    selectReleasePackages(releasePlanFixture, 'server,gateway'),
    ['dashboard', 'gateway', 'server'],
  )
})

test('release package selection omits prerequisites that are already published', () => {
  const plan = {
    order: ['server'],
    packages: [
      { pkg: 'dashboard', deps: [], needsPublish: false },
      { pkg: 'server', deps: ['dashboard'], needsPublish: true },
    ],
  }
  assert.deepEqual(selectReleasePackages(plan, 'server'), ['server'])
})

test('explicit release selection can resume non-npm artifacts after npm is published', () => {
  const plan = {
    order: [],
    packages: [
      { pkg: 'cli', deps: [], needsPublish: false },
      { pkg: 'dashboard', deps: [], needsPublish: false },
      { pkg: 'server', deps: ['dashboard'], needsPublish: false },
    ],
  }
  assert.deepEqual(selectReleasePackages(plan, ''), [])
  assert.deepEqual(selectReleasePackages(plan, 'cli'), ['cli'])
  assert.deepEqual(selectReleasePackages(plan, 'server'), ['server'])
})

test('release package selection fails closed on unknown or inconsistent prerequisites', () => {
  assert.throws(
    () => selectReleasePackages(releasePlanFixture, 'not-a-package'),
    /不在发布计划/,
  )
  assert.throws(
    () => selectReleasePackages({
      order: ['server'],
      packages: [
        { pkg: 'dashboard', deps: [], needsPublish: true },
        { pkg: 'server', deps: ['dashboard'], needsPublish: true },
      ],
    }, 'server'),
    /前置依赖 dashboard 不在 release order/,
  )
})

test('release prerequisite closure matches public artifacts runtime workspace dependencies', async () => {
  const entries = await Promise.all(publicPackages.map(async (pkg) => {
    const manifest = JSON.parse(await readFile(join(root, 'packages', pkg, 'package.json'), 'utf8'))
    const deps = Object.entries(manifest.dependencies ?? {})
      .filter(([name, spec]) => (
        name.startsWith('@tool-bridge/') && String(spec).startsWith('workspace:')
      ))
      .map(([name]) => name.replace('@tool-bridge/', ''))
    return { deps, needsPublish: true, pkg }
  }))

  assert.deepEqual(
    Object.fromEntries(entries.filter(entry => entry.deps.length > 0).map(entry => (
      [entry.pkg, entry.deps]
    ))),
    { server: ['dashboard'] },
  )
  assert.deepEqual(
    selectReleasePackages({ order: publicPackages, packages: entries }, 'server'),
    ['dashboard', 'server'],
  )
})

test('exact npm registry version state distinguishes presence, absence, and failures', async () => {
  const response = (status, body) => ({
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  })
  assert.equal(
    await npmRegistryVersionState('@tool-bridge/example', '1.2.3', async () => (
      response(200, { versions: { '1.2.3': {} } })
    )),
    'present',
  )
  assert.equal(
    await npmRegistryVersionState('@tool-bridge/example', '1.2.4', async () => (
      response(200, { versions: { '1.2.3': {} } })
    )),
    'absent',
  )
  assert.equal(
    await npmRegistryVersionState('@tool-bridge/example', '1.2.3', async () => (
      response(404)
    )),
    'absent',
  )
  await assert.rejects(
    npmRegistryVersionState('@tool-bridge/example', '1.2.3', async () => response(503)),
    /HTTP 503/,
  )
})

test('runtime dependency sections reject workspace-only protocols', () => {
  const unsupported = findUnsupportedRuntimeDependencySpecs({
    dependencies: { alpha: 'catalog:' },
    optionalDependencies: { beta: 'workspace:^' },
    peerDependencies: { gamma: 'catalog:default' },
  })

  assert.deepEqual(unsupported, [
    { field: 'dependencies', name: 'alpha', spec: 'catalog:' },
    { field: 'optionalDependencies', name: 'beta', spec: 'workspace:^' },
    { field: 'peerDependencies', name: 'gamma', spec: 'catalog:default' },
  ])
})

test('devDependencies do not block a packed package', () => {
  assert.deepEqual(findUnsupportedRuntimeDependencySpecs({
    devDependencies: {
      testRunner: 'catalog:',
      workspaceFixture: 'workspace:*',
    },
  }), [])
})

test('registry, alias, URL, git, and npm-supported file specs pass', () => {
  assert.deepEqual(findUnsupportedRuntimeDependencySpecs({
    dependencies: {
      alias: 'npm:other-package@^2.0.0',
      exact: '1.2.3',
      file: 'file:./vendor/example.tgz',
      git: 'git+https://github.com/example/package.git#v1.0.0',
      range: '^4.5.0',
      url: 'https://example.test/package.tgz',
    },
    optionalDependencies: { prerelease: '2.0.0-beta.1' },
    peerDependencies: { wildcard: '*' },
  }), [])
})

test('packed entry targets include conditional subpath exports and types', () => {
  const manifest = {
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: {
      '.': { import: './dist/index.js', types: './dist/index.d.ts' },
      './device': {
        'import': './dist/device.js',
        'react-native': './dist/device.js',
        'types': './dist/device.d.ts',
      },
      './client': {
        'import': './dist/client.js',
        'react-native': './dist/client.js',
        'types': './dist/client.d.ts',
      },
      './store': {
        'import': './dist/store.js',
        'react-native': './dist/store.js',
        'types': './dist/store.d.ts',
      },
    },
  }
  assert.deepEqual(collectPackedEntryTargets(manifest), [
    './dist/client.d.ts',
    './dist/client.js',
    './dist/device.d.ts',
    './dist/device.js',
    './dist/index.d.ts',
    './dist/index.js',
    './dist/store.d.ts',
    './dist/store.js',
  ])
  assert.doesNotThrow(() => assertPackedEntryTargetsExist(manifest, new Set([
    'package/dist/client.d.ts',
    'package/dist/client.js',
    'package/dist/device.d.ts',
    'package/dist/device.js',
    'package/dist/index.d.ts',
    'package/dist/index.js',
    'package/dist/store.d.ts',
    'package/dist/store.js',
  ])))
  assert.throws(
    () => assertPackedEntryTargetsExist(manifest, new Set(['package/dist/index.js'])),
    /missing files/,
  )
})

test('Dashboard packed entry is dist/index.html even without a JS export', () => {
  const manifest = { name: '@tool-bridge/dashboard' }
  assert.deepEqual(collectPackedEntryTargets(manifest), ['./dist/index.html'])
  assert.doesNotThrow(() => assertPackedEntryTargetsExist(
    manifest,
    new Set(['package/dist/index.html']),
  ))
  assert.throws(
    () => assertPackedEntryTargetsExist(manifest, new Set()),
    /missing files/,
  )
})

test('SDK neutral checks include shared runtime and declaration chunks', () => {
  const runtime = new Map([
    ['package/dist/device.js', 'import "./chunk-safe.js"'],
    ['package/dist/chunk-safe.js', 'import "./chunk-host.js"'],
    ['package/dist/chunk-host.js', 'import "node:fs"'],
  ])
  const declarations = new Map([
    ['package/dist/device.d.ts', 'export * from "./types-safe.js"'],
    ['package/dist/types-safe.d.ts', 'export * from "./types-private.js"'],
    ['package/dist/types-private.d.ts', 'type X = import("@tool-bridge/core").TreePath'],
  ])

  assert.throws(
    () => assertSdkDeviceArtifact(
      collectModuleClosure('package/dist/device.js', runtime),
      'export {}',
    ),
    /Node builtin/,
  )
  assert.throws(
    () => assertSdkDeviceArtifact(
      'export {}',
      collectModuleClosure('package/dist/device.d.ts', declarations, true),
    ),
    /private workspace package/,
  )
})

test('SDK device artifact rejects Node runtime and private type leakage', () => {
  assert.doesNotThrow(() => assertSdkDeviceArtifact(
    'import ReconnectingWebSocket from "partysocket/ws"; export const ok = true',
    'export declare const ok: boolean',
  ))
  assert.throws(
    () => assertSdkDeviceArtifact('import WS from "ws"', 'export {}'),
    /Node ws package/,
  )
  assert.throws(
    () => assertSdkDeviceArtifact('export {}', 'type X = import("@tool-bridge/core").TreePath'),
    /private workspace package/,
  )
})

test('SDK Store artifact is fully bundled and rejects host-only leakage', () => {
  assert.doesNotThrow(() => assertSdkStoreArtifact(
    'export const createStoreClient = () => ({})',
    'export declare function createStoreClient(): unknown',
  ))
  assert.throws(
    () => assertSdkStoreArtifact('import "node:fs"', 'export {}'),
    /Node builtin/,
  )
  assert.throws(
    () => assertSdkStoreArtifact('import("hono/client")', 'export {}'),
    /Hono/,
  )
  assert.throws(
    () => assertSdkStoreArtifact('import "zod"', 'export {}'),
    /unexpected imports: zod/,
  )
  assert.throws(
    () => assertSdkStoreArtifact('export {}', 'type X = import("@tool-bridge/core").URI'),
    /private workspace package/,
  )
})

test('SDK client artifact is neutral and declarations do not leak Zod internals', () => {
  assert.doesNotThrow(() => assertSdkClientArtifact(
    'export const createToolBridgeClient = () => ({})',
    'export declare function createToolBridgeClient(): unknown',
  ))
  assert.doesNotThrow(() => assertSdkClientArtifact(
    'export {}',
    '/** Runtime schemas are implemented with Zod. */\nexport interface Response {}',
  ))
  assert.throws(
    () => assertSdkClientArtifact('export {}', 'import * as z from "./v4/classic/external.cjs"'),
    /Zod implementation types/,
  )
  assert.throws(
    () => assertSdkClientArtifact('import "node:fs"', 'export {}'),
    /Node builtin/,
  )
})

test('--bin cannot be combined with --skip-install', () => {
  assert.throws(
    () => parseCliArguments(['packages/cli', '--output-dir', 'artifacts', '--bin', 'tb', '--skip-install']),
    /--bin cannot be used with --skip-install/,
  )
})

test('--skip-install is accepted without --bin', () => {
  assert.deepEqual(
    parseCliArguments(['packages/server', '--output-dir', 'artifacts', '--skip-install']),
    {
      bin: undefined,
      outputDir: 'artifacts',
      packageDir: 'packages/server',
      skipInstall: true,
    },
  )
})

for (const packageName of publicPackages) {
  test(`publish-${packageName}.yml verifies and publishes the same tarball`, async () => {
    const workflow = await readFile(
      join(root, '.github', 'workflows', `publish-${packageName}.yml`),
      'utf8',
    )
    const normalizedWorkflow = workflow.replaceAll(/\\\n\s*/g, ' ')

    assert.match(
      normalizedWorkflow,
      /TARBALL\s*=\s*"\$\(node [^\n]*pack-and-verify-package\.mjs[^\n]*\)"/,
      'workflow must capture pack-and-verify-package.mjs stdout in TARBALL',
    )
    assert.doesNotMatch(
      normalizedWorkflow,
      /pack-and-verify-package\.mjs[^\n]*--skip-install/,
      'publish workflows must perform a clean consumer install',
    )
    if (packageName === 'cli') {
      assert.match(normalizedWorkflow, /pack-and-verify-package\.mjs[^\n]*--bin tb/)
    }

    const publishCommands = workflow.match(/^\s*(?:run:\s*)?npm publish .*$/gm) ?? []
    assert.ok(publishCommands.length > 0, 'workflow must contain an npm publish command')
    for (const command of publishCommands) {
      assert.match(command, /(?:run:\s*)?npm publish "\$TARBALL"\s*$/)
    }
  })
}

const publishValidationClosures = {
  'app': {
    test: ['core', 'app'],
    typecheck: ['core', 'app'],
  },
  'cli': {
    test: ['core', 'sdk', 'cli'],
    typecheck: ['core', 'sdk', 'cli'],
  },
  'dashboard': {
    test: ['core', 'sdk', 'dashboard'],
    typecheck: ['core', 'sdk', 'dashboard'],
  },
  'gateway': {
    test: ['core', 'app', 'plugin-sdk', 'plugins', 'gateway'],
    typecheck: ['core', 'app', 'plugin-sdk', 'plugins', 'gateway'],
  },
  'plugin-sdk': {
    // plugins 是最大契约消费者，只加入 test，不是 SDK 产物闭包。
    test: ['core', 'plugin-sdk', 'plugins'],
    typecheck: ['core', 'plugin-sdk'],
  },
  'sdk': {
    test: ['core', 'app', 'sdk'],
    typecheck: ['core', 'app', 'sdk'],
  },
  'server': {
    test: ['core', 'app', 'plugin-sdk', 'plugins', 'server'],
    typecheck: ['core', 'app', 'plugin-sdk', 'plugins', 'server'],
  },
}

function validationFilterPackages(workflow, command) {
  const normalized = workflow.replaceAll(/\\\n\s*/g, ' ')
  const line = normalized.match(new RegExp(
    `^\\s*- run: pnpm ((?:--filter @tool-bridge\\/[a-z-]+\\s+)+)${command}\\s*$`,
    'm',
  ))
  assert.ok(line, `publish workflow must run ${command} with explicit filters`)
  return [...line[1].matchAll(/--filter @tool-bridge\/([a-z-]+)/g)].map(match => match[1])
}

for (const [packageName, expected] of Object.entries(publishValidationClosures)) {
  test(`publish-${packageName}.yml validates its bundled source closure`, async () => {
    const workflow = await readFile(
      join(root, '.github', 'workflows', `publish-${packageName}.yml`),
      'utf8',
    )
    assert.deepEqual(validationFilterPackages(workflow, 'typecheck'), expected.typecheck)
    assert.deepEqual(validationFilterPackages(workflow, 'test'), expected.test)
  })
}

test('release workflow closes package prerequisites and safely resumes existing tags', async () => {
  const workflow = await readFile(join(root, '.github', 'workflows', 'release.yml'), 'utf8')

  assert.match(
    workflow,
    /node scripts\/select-release-packages\.mjs "\$ONLY"/,
    'package subsets must use the prerequisite-closure selector',
  )
  assert.doesNotMatch(
    workflow,
    /p\.order\.filter\(x => only\.includes\(x\)\)/,
    'workflow must not directly filter the topological order',
  )
  assert.match(workflow, /registry_state "\$PACKAGE_NAME" "\$VERSION"/)
  assert.match(workflow, /TAG_COMMIT_SHA.*GITHUB_SHA/s)
  assert.match(workflow, /re-dispatch 未完成版本/)
  assert.match(workflow, /reuse successful \$WF run/)
  assert.match(workflow, /reuse active \$WF run/)
  assert.match(workflow, /\[ "\$PKG" != 'cli' \]/)
  assert.match(workflow, /gh run list --workflow "\$WF"/)
  assert.match(workflow, /\.headSha == \\"\$GITHUB_SHA\\"/)
  assert.match(workflow, /REGISTRY_READY=false/)
  assert.match(workflow, /registry 180s 内仍不可见/)
  assert.doesNotMatch(workflow, /tag \$TAG 已存在[^\n]*跳过/)
})

test('CLI publish workflow is idempotent when only its image needs retrying', async () => {
  const workflow = await readFile(join(root, '.github', 'workflows', 'publish-cli.yml'), 'utf8')
  assert.match(workflow, /node scripts\/npm-registry-version\.mjs "\$NAME" "\$VERSION"/)
  assert.match(
    workflow,
    /if: steps\.registry-version\.outputs\.state != 'present'\s+run: npm publish "\$TARBALL"/,
  )
  assert.match(workflow, /if: steps\.registry-version\.outputs\.state == 'present'/)
})

test('CI reuses the verifier for packed manifests without requiring unpublished workspace versions', async () => {
  const workflow = await readFile(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const normalizedWorkflow = workflow.replaceAll(/\\\n\s*/g, ' ')

  assert.match(
    normalizedWorkflow,
    /pack-and-verify-package\.mjs[^\n]*--skip-install/,
  )
})
