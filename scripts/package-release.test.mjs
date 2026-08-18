import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  findUnsupportedRuntimeDependencySpecs,
  parseCliArguments,
} from './pack-and-verify-package.mjs'

const root = join(import.meta.dirname, '..')
const publicPackages = ['app', 'cli', 'dashboard', 'gateway', 'plugin-sdk', 'sdk', 'server']

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

test('CI reuses the verifier for packed manifests without requiring unpublished workspace versions', async () => {
  const workflow = await readFile(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
  const normalizedWorkflow = workflow.replaceAll(/\\\n\s*/g, ' ')

  assert.match(
    normalizedWorkflow,
    /pack-and-verify-package\.mjs[^\n]*--skip-install/,
  )
})
