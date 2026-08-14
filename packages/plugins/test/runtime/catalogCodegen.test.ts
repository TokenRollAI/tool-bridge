import { catalogDigest, catalogSetDigest, resolveBuiltinExport } from '@tool-bridge/core'
import { describe, expect, it } from 'vitest'
import { BUILTIN_CATALOG, BUILTIN_CATALOG_DIGEST } from '../../src/catalog.generated'
import { BUILTIN_PLUGIN_LOADERS } from '../../src/registry'

/**
 * 内置目录 descriptor 的**漂移闸门**。
 *
 * `registryCodegen.test.ts` 守的是"磁盘上有哪些插件";这份守的是"每个插件声明了什么"。
 * 后者更容易悄悄漂:改一个 export 的 credentialFields 不会让任何现有测试变红,但挂载表单
 * 会照旧按老声明提示字段 —— 这正是 catalog 化要消灭的那类陈旧(A3)。
 *
 * 闸门放在 test 而不是 build:`pnpm verify` 比发布 workflow 的 build 早得多,而这类断裂
 * 一旦漏到打 tag 之后,返工要删 tag 重打(见 llmdoc/guides/npm-publish.md)。
 */

describe('catalog.generated.ts', () => {
  it('覆盖装配表里的全部插件(加删插件后要重跑 generate:catalog)', () => {
    expect(Object.keys(BUILTIN_CATALOG).sort()).toEqual(Object.keys(BUILTIN_PLUGIN_LOADERS).sort())
  })

  it('每条 descriptor 与磁盘上插件的 ~describe 求值一致', async () => {
    for (const [id, entry] of Object.entries(BUILTIN_CATALOG)) {
      const loader = BUILTIN_PLUGIN_LOADERS[id]
      expect(loader, `装配表缺 '${id}'`).toBeDefined()
      const mod = await loader!()
      const resp = await mod.default.fetch(
        new Request('https://catalog.invalid/~describe'),
        {} as never,
      )
      expect(resp.status, `${id} 的 ~describe`).toBe(200)
      const describe = await resp.json()
      // 逐条比 digest 而不是比对象:失败时报的是"哪个插件漂了",而不是一屏 diff。
      expect(await catalogDigest(describe), `${id} 的 descriptor 漂了`).toBe(entry.digest)
    }
  })

  it('目录级 digest 与逐条 digest 对得上', async () => {
    expect(await catalogSetDigest(BUILTIN_CATALOG)).toBe(BUILTIN_CATALOG_DIGEST)
  })

  it('endpoint 恒为 binding:<id>(builtin 只有进程内这一种形态)', () => {
    for (const [id, entry] of Object.entries(BUILTIN_CATALOG)) {
      expect(entry.endpoint).toBe(`binding:${id}`)
      expect(entry.kind).toBe('builtin')
    }
  })

  /**
   * catalog 的存在意义是"不查库就能解析挂载目标"。这条用真实目录跑一遍解析,
   * 顺带证明 `resolveBuiltinExport` **没有 store 参数也能工作** —— 那是 A1 的结构性保证。
   */
  it('目录项可直接解析出 export(零 store、零 IO)', () => {
    const withSingleToolsExport = Object.entries(BUILTIN_CATALOG).find(
      ([, e]) => e.describe.exports.length === 1 && e.describe.exports[0]!.profile === 'tools/v1',
    )
    expect(withSingleToolsExport).toBeDefined()
    const [id] = withSingleToolsExport!
    const resolved = resolveBuiltinExport(BUILTIN_CATALOG, id, 'tool', 'tool')
    expect(resolved.source).toBe('builtin')
    expect(resolved.manifest.endpoint).toBe(`binding:${id}`)
    expect(resolved.export.profile).toBe('tools/v1')
  })

  it('目录里没有的 id → invalid_argument(不因为"是内置"就放行)', () => {
    expect(() => resolveBuiltinExport(BUILTIN_CATALOG, 'nope-not-here', 'tool', 'tool'))
      .toThrow(/未知 tool provider/)
  })
})
