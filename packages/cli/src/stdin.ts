import { CliError } from './http'

/**
 * stdin 读取的唯一底层实现(此前 4 份副本:integration/secret/plugin 各一份 async 版
 * + ctx put/call 的 readFileSync(0) 版,trim 语义有三种)。
 * 走 process.stdin 异步迭代而不是 readFileSync(0):后者绕开 process.stdin 对象,
 * 测试无法在进程内替换 fd 0(只能 mock 整个 node:fs),且对非阻塞管道会抛 EAGAIN。
 * 整块内容读取(ctx put / call --args-file - / plugin --file -)直接用它,原样不动内容。
 */
export async function readStdinRaw(): Promise<string> {
  try {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  } catch (err) {
    throw new CliError(`cannot read stdin: ${(err as Error).message}`)
  }
}

/**
 * 凭证类 stdin(secret set / integration --key-stdin):只去除一个尾随换行(兼容 \r\n),
 * 不整体 trim —— `echo` 会补一个 \n,而凭证首尾与内部的其余空白可能是有意义的。
 */
export async function readStdinCredential(): Promise<string> {
  return (await readStdinRaw()).replace(/\r?\n$/, '')
}
