import { runMain } from '../src/main'

/**
 * JSON fetch 桩的统一响应构造器。
 *
 * `~register` 的生产响应是完整 TreeNode；测试通常只关心 path/kind，因此成功响应
 * 从请求 NodeInput 补齐 description/config，再让显式 payload 覆盖。错误响应保持原样。
 */
export function mockJsonResponse(
  url: string | URL | Request,
  init: RequestInit | undefined,
  payload: unknown,
  status = 200,
): Response {
  let responsePayload = payload
  if (
    status >= 200
    && status < 300
    && /\/~register(?:[?#]|$)/.test(String(url))
    && payload !== null
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && typeof init?.body === 'string'
  ) {
    const requestPayload = JSON.parse(init.body) as unknown
    if (requestPayload !== null && typeof requestPayload === 'object' && !Array.isArray(requestPayload)) {
      responsePayload = { ...requestPayload, ...payload }
    }
  }

  return new Response(JSON.stringify(responsePayload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 测试 argv 不含 node/脚本名，但错误捕获与生产入口完全相同。 */
export async function runCli(argv: string[]): Promise<void> {
  await runMain(argv, { from: 'user' })
}

/** 断言用：返回生产 catch 捕获的 CommanderError.code。 */
export async function parseError(argv: string[]): Promise<string | null> {
  const result = await runMain(argv, { from: 'user' })
  if (result.ok) return null
  return result.code ?? 'unknown'
}
