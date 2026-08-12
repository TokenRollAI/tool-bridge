import { describe, expect, it } from 'vitest'
import { BUILTIN_PLUGIN_ENV_KEYS, BUILTIN_PLUGIN_LOADERS, builtinPluginBindings, narrowPluginEnv } from '../../src/registry'

/**
 * 插件拿到的 env 必须是白名单收窄后的,不是宿主全环境。
 *
 * 进程内插件与网关**同权**(plugin-in-process-catalog 决策):把 `process.env` 整份递下去,
 * 任一 handler 一行 `ctx.env.TB_SECRET_ENCRYPTION_KEY` 就拿到 SecretStore 主密钥 ——
 * 「凭证不出网关」整条防线归零,而且没有隔离层能拦。
 *
 * 这条约束必须由**代码**保证:接线宿主的人不会记得"别把 process.env 传进去",而
 * `builtinPluginBindings` 的注释以前恰恰写着"Node 宿主常用 process.env"。
 */

describe('narrowPluginEnv', () => {
  it('**平台机密一律不进插件**', () => {
    const narrowed = narrowPluginEnv({
      PLUGIN_TOKEN: 'tbk_x',
      TB_SECRET_ENCRYPTION_KEY: 'MASTER_KEY',
      TB_BOOTSTRAP_ADMIN_SK: 'ADMIN_SK',
      CLOUDFLARE_API_TOKEN: 'CF_TOKEN',
      AWS_SECRET_ACCESS_KEY: 'AWS_SECRET',
    })
    expect(narrowed).toEqual({ PLUGIN_TOKEN: 'tbk_x' })
    // 逐个点名,好让失败信息直接说清漏了哪个。
    for (const key of ['TB_SECRET_ENCRYPTION_KEY', 'TB_BOOTSTRAP_ADMIN_SK', 'CLOUDFLARE_API_TOKEN']) {
      expect(narrowed, `${key} 泄漏进插件 env`).not.toHaveProperty(key)
    }
    expect(JSON.stringify(narrowed)).not.toContain('MASTER_KEY')
  })

  it('宿主的常规环境变量也不进(只放白名单,不是只挡黑名单)', () => {
    expect(narrowPluginEnv({ PATH: '/usr/bin', HOME: '/root', NODE_ENV: 'production' })).toEqual({})
  })

  it('白名单内的插件配置项照常递下去', () => {
    expect(narrowPluginEnv({
      PLUGIN_TOKEN: 't',
      FEISHU_MCP_URL: 'https://mock/mcp',
      FEISHU_ALLOWED_TOOLS: 'a,b',
      TB_SECRET_ENCRYPTION_KEY: 'nope',
    })).toEqual({
      PLUGIN_TOKEN: 't',
      FEISHU_MCP_URL: 'https://mock/mcp',
      FEISHU_ALLOWED_TOOLS: 'a,b',
    })
  })

  it('白名单只含各插件声明的非机密配置项', () => {
    // 变更这个列表应当是有意识的动作:新增键要在 registry.ts 里登记并说明用途。
    expect([...BUILTIN_PLUGIN_ENV_KEYS].sort()).toEqual([
      'FEISHU_ALLOWED_TOOLS',
      'FEISHU_AUTH_URL',
      'FEISHU_MCP_URL',
    ])
  })
})

describe('builtinPluginBindings', () => {
  it('宿主可以放心传整份 process.env(收窄在装配时发生)', () => {
    const bindings = builtinPluginBindings({
      PLUGIN_TOKEN: 't',
      TB_SECRET_ENCRYPTION_KEY: 'MASTER_KEY',
      PATH: '/usr/bin',
    })
    // 不给 include 时装配整个目录 —— 断言对着 loader 表本身,而不是某个写死的数量:
    // 目录会随策展增删,而"装配面 === 可用面"这条不变。
    expect(bindings.size).toBe(Object.keys(BUILTIN_PLUGIN_LOADERS).length)
    expect(bindings.size).toBeGreaterThan(0)
  })
})
