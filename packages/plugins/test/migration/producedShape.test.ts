import type { Plugin } from '@tool-bridge/plugin-sdk'
import { describe, expect, it } from 'vitest'
import RAW_FINGERPRINTS from '../../migration-fingerprints.json'
import { BUILTIN_PLUGIN_LOADERS } from '../../src/registry'

/**
 * 迁移产物的形状闸门:凡是在 `migration-fingerprints.json` 里登记过的 provider,都必须是一个
 * **装得起来的 tool-bridge 插件**,且它自报的工具集与规格表一致。
 *
 * 与 schemaParity 的分工:那条管"schema 迁得对",这条管"整个产物拼得起来"。批量迁移时
 * 人工逐个核对不现实 —— 少写一个 handler、export id 拼错、忘了 default export,
 * 都要在这里当场炸,而不是等到挂载时才发现。
 */

const INDEXES = import.meta.glob<{ default?: Plugin<unknown> }>('../../src/*/index.ts', { eager: true })
const SCHEMAS = import.meta.glob<Record<string, unknown>>('../../src/*/schema.ts', { eager: true })

/**
 * 显式标注而不是直接吃 JSON 的推断类型:推断出来的 `providers` 是每个 provider 名的**字面量
 * 联合**,用 `string` 索引它会 TS7053。契约本来就是"任意 service 名 → 指纹",标出来即可。
 */
const FINGERPRINTS: { providers: Record<string, { actions: Record<string, unknown> }> }
  = RAW_FINGERPRINTS

/** 迁移产物 = 在全局指纹清单里登记过的 provider。 */
const migrated = Object.keys(FINGERPRINTS.providers).sort()

it('每个迁移产物都接进了内置目录(漏接线的插件挂不上树,却不会有任何报错)', () => {
  const registered = Object.keys(BUILTIN_PLUGIN_LOADERS).sort()
  expect(migrated.filter(service => !registered.includes(service))).toEqual([])
})

describe.each(migrated)('%s', (service: string) => {
  const names = Object.keys(FINGERPRINTS.providers[service]!.actions).sort()

  it('导出了 default plugin(可被内置目录懒加载)', () => {
    const mod = INDEXES[`../../src/${service}/index.ts`]
    expect(mod, `${service} 缺 index.ts`).toBeDefined()
    expect(typeof mod!.default?.fetch, `${service} 的 default export 不是 plugin`).toBe('function')
  })

  it('规格表的 action 集合与上游快照一致', () => {
    const mod = SCHEMAS[`../../src/${service}/schema.ts`]!
    const table = Object.entries(mod).find(([name]) => name.endsWith('Actions'))?.[1]
    expect(Object.keys(table as object).sort()).toEqual(names)
  })

  it('~describe 报单个 tools/v1 export', async () => {
    const plugin = INDEXES[`../../src/${service}/index.ts`]!.default!
    const res = await plugin.fetch(new Request('https://p.test/~describe'), {} as never)
    const body = (await res.json()) as { exports: Array<{ id: string, profile: string }> }
    expect(body.exports).toHaveLength(1)
    expect(body.exports[0]?.profile).toBe('tools/v1')
  })

  it('~help 列出的工具集 === 上游 action 集合(宣告与可调用集合吻合)', async () => {
    const plugin = INDEXES[`../../src/${service}/index.ts`]!.default!
    const res = await plugin.fetch(new Request('https://p.test/~help'), {} as never)
    const body = (await res.json()) as { exports: Array<{ cmds: Array<{ name: string }> }> }
    expect(body.exports[0]?.cmds.map(cmd => cmd.name).sort()).toEqual(names)
  })

  it('每个工具都带 inputSchema 与 outputSchema', () => {
    const mod = SCHEMAS[`../../src/${service}/schema.ts`]!
    const table = Object.entries(mod).find(([name]) => name.endsWith('Actions'))![1] as Record<
      string,
      { inputSchema?: unknown, outputSchema?: unknown }
    >
    for (const name of names) {
      expect(table[name]?.inputSchema, `${service}.${name} 缺 inputSchema`).toBeDefined()
      expect(table[name]?.outputSchema, `${service}.${name} 缺 outputSchema`).toBeDefined()
    }
  })
})
