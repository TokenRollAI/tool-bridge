import { html } from 'hono/html'

export function consentPage(action: string, redirectUri: string, invalidKey = false): Response {
  const page = html`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>授权 ChatGPT 访问 Tool Bridge</title>
  <style>
    :root { color-scheme: light dark; font: 100%/1.6 system-ui, sans-serif; }
    main { max-width: 30rem; margin: 12vh auto; padding: 0 1.25rem; }
    h1 { font-size: 1.5rem; line-height: 1.35; }
    label, input, button { display: block; }
    input, button { box-sizing: border-box; font: inherit; padding: .5rem .75rem; }
    input { width: 100%; margin: .25rem 0 1rem; }
    button { display: inline-block; cursor: pointer; }
  </style>
</head>
<body><main>
  <h1>授权 ChatGPT 访问 Tool Bridge</h1>
  <p>ChatGPT 将在一小时内通过 MCP 使用这把密钥允许的工具。密钥只提交到此网关。</p>
  <form method="post" action="${action}">
    <label for="sk">网关访问密钥（SK）</label>
    <input id="sk" name="sk" type="password" autocomplete="off" required>
    ${invalidKey ? html`<p role="alert">密钥无效或已过期，请重新输入。</p>` : ''}
    <button type="submit">确认授权</button>
    <button type="submit" name="decision" value="deny" formnovalidate>取消</button>
  </form>
</main></body></html>`
  return new Response(page.toString(), {
    status: invalidKey ? 401 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' ${redirectUri}`,
    },
  })
}
