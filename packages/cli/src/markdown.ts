import { Marked } from 'marked'
import { markedTerminal } from 'marked-terminal'
import { printLine } from './output'

/**
 * markdown 落地策略:stdout 是 TTY(人在看)→ marked-terminal 渲染 ANSI 富文本;
 * 非 TTY(管道 / Agent 捕获 / 重定向)→ 裸 markdown 原样输出(对机器就是最好的形态)。
 * NO_COLOR(https://no-color.org)强制裸输出。
 */
export function shouldRenderAnsi(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
}

let renderer: Marked | undefined

/** markdown → ANSI 富文本(懒初始化单例;marked 同步 parse)。 */
export function renderMarkdownAnsi(md: string): string {
  if (!renderer) {
    renderer = new Marked()
    // @types/marked-terminal 把返回值标成 TerminalRenderer,但 markedTerminal() 实际返回
    // MarkedExtension(官方 README 用法);断言桥接这个上游类型缺口。
    renderer.use(markedTerminal() as Parameters<Marked['use']>[0])
  }
  return renderer.parse(md, { async: false })
}

/** 按 TTY 判定输出 markdown(渲染失败降级裸输出,永不因渲染死掉)。 */
export function printMarkdown(md: string): void {
  const body = md.replace(/\n+$/, '')
  if (!shouldRenderAnsi()) {
    printLine(body)
    return
  }
  try {
    printLine(renderMarkdownAnsi(body).replace(/\n+$/, ''))
  } catch {
    printLine(body)
  }
}
