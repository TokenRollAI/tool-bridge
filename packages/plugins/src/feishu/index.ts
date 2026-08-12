/**
 * 飞书官方远程 MCP 的 plugin(CF Worker,自部署后注册进 tool-bridge)。
 *
 * 解决的问题:飞书 TAT 凭证约 2h 过期,直接以 kind:mcp 挂载须人工 `tb secret set` 续期;
 * 本 plugin 按需换发并缓存 TAT(tat.ts),上游 401 时强制重换发重试一次——对平台侧
 * 呈现为永不过期的工具源。
 *
 * **协议零样板**:健康检查、`/~describe`(v2 exports)、`/~help`、envelope 编解码、
 * Bearer 鉴权、`X-TB-Request-Id` 去重、上游凭证解包、错误归一全部由
 * `@tool-bridge/plugin-sdk` 接管;本文件只剩飞书业务(换发、重试、ToolSpec 转换)。
 *
 * 用的是 SDK 的**代理型** export(`proxyTools`):工具表的真源是飞书上游,
 * 只有拿到凭证才能枚举,故不在声明期写死 —— 由 plugin 复述一份 schema 只会漂移。
 *
 * **凭证边界**:app_id/app_secret 不由 plugin 自持——凭证存平台 SecretStore(挂载
 * config.authRef),每次调用由平台 resolve 后经 `X-TB-Upstream-Auth`(base64url JSON
 * `{"app_id":"...","app_secret":"..."}`)传入,SDK 解包后即 `ctx.upstreamAuth` 明文。
 * plugin 无凭证即不可用:公网可达的 endpoint 即使 PLUGIN_TOKEN 泄漏,也拿不到任何
 * 飞书凭证;同一部署可服务多个不同凭证的挂载(TAT 缓存按 app_id 键控)。
 *
 * env(wrangler secret / vars):
 *   PLUGIN_TOKEN                      — 平台 pluginToken(secret;未配置时仅要求 Bearer 非空)
 *   FEISHU_ALLOWED_TOOLS              — 工具白名单(vars,逗号分隔;飞书无此头恒回空列表)
 *   FEISHU_MCP_URL / FEISHU_AUTH_URL  — 端点 override(vars,可缺省)
 */

import { createPlugin, type PluginCallContext, TBError, type ToolSpec } from '@tool-bridge/plugin-sdk'
import {
  callTool,
  DEFAULT_MCP_URL,
  type FeishuMcpConfig,
  type FeishuTool,
  isUnauthorized,
  listTools,
} from './feishuMcp'
import { tenantAccessToken } from './tat'

export interface Env {
  FEISHU_ALLOWED_TOOLS: string
  FEISHU_AUTH_URL?: string
  FEISHU_MCP_URL?: string
  PLUGIN_TOKEN?: string
}

/** X-TB-Upstream-Auth 解包后的飞书凭证形状。 */
interface FeishuCredential {
  app_id: string
  app_secret: string
}

/**
 * 取飞书凭证。字段由本 export 的 `credentialFields` 声明,SDK 已按声明解析并校验必填 ——
 * 这里只处理"整份凭证没配"(挂载少配 authRef,是配置错误不是调用方参数错)。
 *
 * 从前这里手写 JSON.parse + 逐字段校验:那时平台不知道凭证里有什么,只能靠"把 JSON 塞进
 * 单值通道"的约定。现在字段是声明的,平台在**挂载时**就会校验齐全并点名缺哪个。
 */
function credentialOf(ctx: PluginCallContext<Env>): FeishuCredential {
  const values = ctx.credentials
  if (values === undefined) {
    throw new TBError(
      'unavailable',
      '缺上游凭证:挂载节点须配置 authRef,凭证用 `tb secret set <name>'
      + ' --field app_id=... --field app_secret=...` 写入',
      { retryable: false },
    )
  }
  return { app_id: values.app_id!, app_secret: values.app_secret! }
}

/** 飞书 annotations → ToolSpec.effect(与 gateway providers/mcp.ts 同规则)。 */
function toSpec(t: FeishuTool): ToolSpec {
  const spec: ToolSpec = { name: t.name }
  if (t.description !== undefined) spec.description = t.description
  if (t.inputSchema !== undefined) spec.inputSchema = t.inputSchema
  if (t.annotations?.readOnlyHint === true) spec.effect = 'read'
  else if (t.annotations?.destructiveHint === true) spec.effect = 'destructive'
  return spec
}

async function mcpConfig(
  env: Env,
  cred: FeishuCredential,
  forceTat = false,
): Promise<FeishuMcpConfig> {
  const tat = await tenantAccessToken(
    {
      appId: cred.app_id,
      appSecret: cred.app_secret,
      ...(env.FEISHU_AUTH_URL !== undefined ? { authUrl: env.FEISHU_AUTH_URL } : {}),
    },
    forceTat,
  )
  return {
    url: env.FEISHU_MCP_URL ?? DEFAULT_MCP_URL,
    appId: cred.app_id,
    tat,
    allowedTools: env.FEISHU_ALLOWED_TOOLS ?? '',
  }
}

/**
 * 执行 `fn`,上游 401 时强制重换发 TAT 后重试一次。缓存的 TAT 在余量内也可能已被
 * 飞书吊销(如重置 app_secret),401 是唯一失效信号;重试必须绕过缓存(force)。
 */
async function withTatRetry<T>(
  ctx: PluginCallContext<Env>,
  fn: (cfg: FeishuMcpConfig) => Promise<T>,
): Promise<T> {
  const cred = credentialOf(ctx)
  try {
    return await fn(await mcpConfig(ctx.env, cred))
  } catch (err) {
    if (!isUnauthorized(err)) throw err
    return await fn(await mcpConfig(ctx.env, cred, true))
  }
}

/** 工厂形态:测试可起多份;部署用下面的默认实例。 */
export function createFeishuPlugin() {
  const plugin = createPlugin<Env>({ token: env => env.PLUGIN_TOKEN })
  plugin.proxyTools('actions', {
    description: 'Feishu actions (docs, wiki, messaging) via the official MCP upstream',
    // 飞书自建应用凭证:两个字段,由平台在挂载时校验齐全(见 core PluginExport.credentialFields)。
    credentialFields: [
      {
        key: 'app_id',
        label: 'App ID',
        required: true,
        description: '飞书自建应用的 app_id(开放平台「凭证与基础信息」页)',
      },
      {
        key: 'app_secret',
        label: 'App Secret',
        required: true,
        secret: true,
        description: '飞书自建应用的 app_secret,用于换发 tenant_access_token',
      },
    ],
    list: async ctx => (await withTatRetry(ctx, listTools)).map(toSpec),
    // MCP RPC 业务错误(isError)是正常返回值,原样进 ToolResult。
    call: async ({ name, args }, ctx) => await withTatRetry(ctx, cfg => callTool(cfg, name, args)),
  })
  return plugin
}

export default createFeishuPlugin()
