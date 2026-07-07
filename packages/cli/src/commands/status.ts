import { Command } from 'commander'
import { resolveTarget, withGlobalOpts } from '../args'

interface HealthzBody {
  healthy?: boolean
  version?: string
}

interface StatusOpts {
  json?: boolean
  baseUrl?: string
  sk?: string
}

/**
 * `tb status` —— 部署环境健康摘要。
 *
 * 直接打 `GET /healthz`。`--json` 输出可解析对象。
 */
export function statusCommand(): Command {
  return withGlobalOpts(new Command('status'))
    .description('Show deployment health summary (GET /healthz)')
    .action(async (opts: StatusOpts) => {
      const asJson = Boolean(opts.json)
      const { baseUrl, sk } = resolveTarget(opts)

      if (!baseUrl) {
        emitError(asJson, 'missing base URL: pass --base-url or set TB_BASE_URL')
        return
      }

      const url = `${baseUrl.replace(/\/+$/, '')}/healthz`
      let res: Response
      try {
        res = await fetch(url, {
          headers: sk ? { authorization: `Bearer ${sk}` } : {},
        })
      } catch (err) {
        emitError(asJson, `request failed: ${(err as Error).message}`, url)
        return
      }

      const raw = await res.text()
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

/** 统一错误出口:`--json` 时输出可解析对象,否则写 stderr;退出码非 0。 */
function emitError(asJson: boolean, message: string, url?: string): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok: false, healthy: false, error: message, url })}\n`)
  } else {
    process.stderr.write(`error: ${message}\n`)
  }
  process.exitCode = 1
}
