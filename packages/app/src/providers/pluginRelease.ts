import { httpsReleaseUrl, parsePluginRelease, pluginVersionPattern, type ResolvedPluginRelease, TBError } from '@tool-bridge/core'
import { z } from 'zod/v4'
import { readRemoteResponseBody } from './remote'

// No package installation, archive extraction, or package-provided executable runs here.
const npmSource = /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@([^@/]+)$/
const githubSource = /^github:([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)@([A-Za-z0-9][A-Za-z0-9._-]*)$/

async function fetchJson(url: string, githubAsset: boolean): Promise<unknown> {
  const signal = AbortSignal.timeout(15_000)
  const get = (target: string) => fetch(target, { headers: { accept: 'application/json' }, signal, redirect: 'manual' })
  try {
    let response = await get(url)
    if (githubAsset && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = new URL(response.headers.get('location') ?? '', url)
      await response.body?.cancel()
      if (location.protocol !== 'https:' || location.hostname !== 'release-assets.githubusercontent.com'
        || location.username || location.password || location.port) throw new Error()
      response = await get(location.href)
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error()
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      await readRemoteResponseBody(response, 256 * 1024, signal),
    )) as unknown
  } catch {
    throw new TBError('unavailable', 'could not read a bounded JSON plugin release from its source')
  }
}

function fixedReference(input: string): string {
  if (!input.startsWith('https://')) return input
  const url = new URL(httpsReleaseUrl(input))
  const path = url.pathname.replace(/\/+$/, '')
  if (url.origin === 'https://www.npmjs.com' || url.origin === 'https://npmjs.com') {
    const version = /^\/package\/((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)\/v\/([^/]+)$/.exec(path)
    if (version) return 'npm:' + version[1] + '@' + version[2]
    throw new TBError('invalid_argument', 'choose a fixed npm package version page ending in /v/1.2.3')
  }
  if (url.origin === 'https://github.com') {
    const release = /^\/([A-Za-z0-9-]+\/[A-Za-z0-9_.-]+)\/releases\/(?:tag\/([^/]+)|download\/([^/]+)\/tool-bridge-plugin\.json)$/.exec(path)
    if (release && (release[2] ?? release[3]) !== 'latest') return 'github:' + release[1] + '@' + (release[2] ?? release[3])
    throw new TBError('invalid_argument', 'choose a fixed GitHub Release page ending in /releases/tag/<tag>')
  }
  return url.href
}

export async function resolvePluginRelease(input: string): Promise<ResolvedPluginRelease> {
  const source = fixedReference(input)
  if (source.startsWith('https://')) return { resolvedSource: source, release: parsePluginRelease(await fetchJson(source, false)) }
  const npm = npmSource.exec(source)
  if (npm && pluginVersionPattern.test(npm[2]!)) {
    const [, name, version] = npm
    const meta = z.object({ name: z.literal(name!), version: z.literal(version!), toolBridgePlugin: z.unknown() })
      .safeParse(await fetchJson('https://registry.npmjs.org/' + encodeURIComponent(name!) + '/' + encodeURIComponent(version!), false))
    if (!meta.success) throw new TBError('invalid_argument', 'npm package identity does not match source')
    const release = parsePluginRelease(meta.data.toolBridgePlugin)
    if (release.version !== version) throw new TBError('invalid_argument', 'plugin version does not match npm version')
    return { release, resolvedSource: source }
  }
  const github = githubSource.exec(source)
  if (github && github[2] !== '.' && github[2] !== '..' && github[3] !== 'latest') {
    const [, owner, repo, tag] = github
    const release = parsePluginRelease(await fetchJson(`https://github.com/${owner}/${repo}/releases/download/${tag}/tool-bridge-plugin.json`, true))
    return { release, resolvedSource: source }
  }
  throw new TBError('invalid_argument', 'expected HTTPS manifest URL, npm:package@exact-version or github:owner/repo@release-tag')
}
