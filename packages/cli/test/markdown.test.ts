import { afterEach, describe, expect, it, vi } from 'vitest'
import { printMarkdown, renderMarkdownAnsi, shouldRenderAnsi } from '../src/markdown'

const originalIsTTY = process.stdout.isTTY

function setTTY(v: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value: v, configurable: true })
}

afterEach(() => {
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function captureStdout(): string[] {
  const out: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  return out
}

describe('shouldRenderAnsi(TTY 判定)', () => {
  it('非 TTY(管道/Agent 捕获)→ false', () => {
    setTTY(false)
    expect(shouldRenderAnsi()).toBe(false)
  })

  it('TTY → true;NO_COLOR 强制关闭', () => {
    setTTY(true)
    vi.stubEnv('NO_COLOR', '')
    expect(shouldRenderAnsi()).toBe(true)
    vi.stubEnv('NO_COLOR', '1')
    expect(shouldRenderAnsi()).toBe(false)
  })
})

describe('printMarkdown', () => {
  it('非 TTY:裸 markdown 原样输出(尾随空行折叠为单 \\n)', () => {
    setTTY(false)
    const out = captureStdout()
    printMarkdown('# Title\n\nSome **bold**.\n\n')
    expect(out.join('')).toBe('# Title\n\nSome **bold**.\n')
  })

  it('TTY:经 ANSI 渲染(markdown 语法标记被消费,如 **bold**)', () => {
    setTTY(true)
    vi.stubEnv('NO_COLOR', '')
    const out = captureStdout()
    printMarkdown('# Title\n\nSome **bold** body')
    const text = out.join('')
    expect(text).not.toContain('**bold**')
    expect(text).toContain('bold')
    expect(text).toContain('Title')
  })
})

describe('renderMarkdownAnsi', () => {
  it('表格渲染为盒线(非裸管道符语法)', () => {
    const rendered = renderMarkdownAnsi('| A | B |\n|---|---|\n| 1 | 2 |')
    expect(rendered).toContain('┌')
    expect(rendered).toContain('│')
  })

  it('~ 保留段不被当删除线吃掉(GFM 单波浪号回归:/~help … /~tree 同行)', () => {
    const rendered = renderMarkdownAnsi(
      '> **Next step**: GET /<child-path>/~help describes a child node; GET /~tree?depth=N shows the subtree',
    )
    expect(rendered).toContain('~help')
    expect(rendered).toContain('~tree')
  })
})
