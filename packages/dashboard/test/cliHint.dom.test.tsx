import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext, type SessionState } from '@/lib/session-context'
import { CliHint } from '@/components/node/CliHint'

const session: SessionState = {
  active: {
    id: 'test',
    name: 'test',
    baseUrl: 'https://tool-bridge.example',
    sk: 'tbk_secret_must_not_render',
  },
  conn: { baseUrl: 'https://tool-bridge.example', sk: 'tbk_secret_must_not_render' },
  login: vi.fn(),
  logout: vi.fn(),
  profiles: [],
  removeProfile: vi.fn(),
  revision: 0,
  switchTo: vi.fn(),
}

afterEach(cleanup)

describe('CliHint 直连命令提示', () => {
  it('CLI 与 curl 都使用完整命令叶子路径，且不生成 --tool 或调用信封', () => {
    render(
      <SessionContext.Provider value={session}>
        <CliHint
          args={{ command: 'git status' }}
          commandPath="device/djj-mac/shell/exec"
        />
      </SessionContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /等价 CLI \/ curl/ }))
    const hint = screen.getByText('tb', { selector: 'span' }).parentElement?.parentElement
    const text = hint?.textContent ?? ''

    expect(text).toContain('tb call device/djj-mac/shell/exec')
    expect(text).toContain(`curl -X POST 'https://tool-bridge.example/device/djj-mac/shell/exec'`)
    expect(text).toContain(`--args '{"command":"git status"}'`)
    expect(text).toContain(`-d '{"command":"git status"}'`)
    expect(text).not.toContain('--tool')
    expect(text).not.toContain('"tool"')
    expect(text).not.toContain('"arguments"')
    expect(text).not.toContain('tbk_secret_must_not_render')
    expect(text).toContain('$TB_SK')
  })

  it('把 fallback 作为同一次调用的保留控制参数呈现', () => {
    render(
      <SessionContext.Provider value={session}>
        <CliHint
          args={{ text: 'hello' }}
          commandPath="device/phone/tools/mail/send"
          delivery="fallback"
          idempotencyKey="agent-task-1"
          ttlSeconds={300}
        />
      </SessionContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /等价 CLI \/ curl/ }))
    const text = screen.getByText('tb', { selector: 'span' }).parentElement?.parentElement
      ?.textContent ?? ''
    expect(text).toContain('--delivery fallback --ttl 300')
    expect(text).toContain('--idempotency-key')
    expect(text).toContain('?ttlSeconds=300')
    expect(text).toContain('"~delivery":"fallback"')
    expect(text).not.toContain('~enqueue')
  })
})
