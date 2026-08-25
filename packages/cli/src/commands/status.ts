import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'
import { apiFetch, CliError } from '../http'

interface HealthzBody {
  healthy?: boolean
  version?: string
}

/**
 * `tb status` —— 部署环境健康摘要。
 *
 * 直接打 `GET /healthz`。`--json` 输出可解析对象。
 */
export function statusCommand() {
  return withGlobalOpts(new Command('status'))
    .description('Show deployment health summary (GET /healthz)')
    .action(async (opts) => {
      const asJson = Boolean(opts.json)
      const target = resolveTarget(opts)
      const { baseUrl } = target

      if (!baseUrl) {
        throw new CliError('missing base URL: pass --base-url or set TB_BASE_URL')
      }

      const url = `${baseUrl.replace(/\/+$/, '')}/healthz`
      const res = await apiFetch(target, { path: '/healthz', accept: 'json' })

      const raw = res.text
      let body: unknown = raw
      try {
        body = JSON.parse(raw)
      } catch {
        // 非 JSON 响应:保留原始文本
      }

      const parsed = (typeof body === 'object' && body !== null ? body : {}) as HealthzBody
      const healthy = res.ok && parsed.healthy === true

      if (asJson) {
        process.stdout.write(
          `${JSON.stringify({
            ok: res.ok,
            status: res.status,
            healthy,
            url,
            version: parsed.version ?? null,
            body,
          })}\n`,
        )
      } else {
        process.stdout.write(`endpoint: ${url}\n`)
        process.stdout.write(`status:   ${res.status} (${healthy ? 'healthy' : 'unhealthy'})\n`)
        if (parsed.version) process.stdout.write(`version:  ${parsed.version}\n`)
      }

      process.exitCode = healthy ? 0 : 1
    })
}
