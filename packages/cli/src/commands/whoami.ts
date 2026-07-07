import { defineCommand } from 'citty'
import { globalArgs, resolveTarget } from '../args'
import { apiFetch, callTool, requireTarget } from '../http'
import { guard, maskSecret, printJson, printLine } from '../output'
import type { StatusView } from '../types'

/**
 * `tb whoami` —— 呈现当前"配置态 + 可达性"。
 *
 * 网关无专门 whoami 端点(SKRegistry 需 admin,不能反查自身身份),
 * 故用"配置态 + 可达性"呈现:
 * - 显示配置的 baseUrl 与打码 SK;
 * - `GET /~help` 探可达/认证(401 = SK 被拒,其它 = 已认证);
 * - 若能调 `system/status get` 则附健康摘要(失败静默忽略)。
 */
export const whoamiCommand = defineCommand({
  meta: {
    name: 'whoami',
    description: 'Show configured target + reachability (no whoami endpoint)',
  },
  args: globalArgs,
  async run({ args }) {
    const asJson = Boolean(args.json)
    await guard(asJson, async () => {
      const target = resolveTarget(args)
      const { baseUrl, sk } = requireTarget(target)

      const res = await apiFetch(target, { path: '/~help', accept: 'text' })
      const authenticated = res.status !== 401

      let health: StatusView | undefined
      if (authenticated) {
        try {
          health = await callTool<StatusView>(target, '/system/status', 'get', {})
        } catch {
          // system/status 不可达或无权:whoami 不因此失败
        }
      }

      if (asJson) {
        printJson({
          baseUrl,
          sk: sk ? maskSecret(sk) : null,
          authenticated,
          status: res.status,
          health: health ?? null,
        })
      } else {
        printLine(`base URL: ${baseUrl}`)
        printLine(`sk:       ${sk ? maskSecret(sk) : '(none)'}`)
        printLine(`auth:     ${authenticated ? 'ok' : 'rejected (401)'}`)
        if (health) {
          const v = health.version ? ` v${health.version}` : ''
          printLine(`health:   ${health.healthy ? 'healthy' : 'unhealthy'}${v}`)
        }
      }
    })
  },
})
