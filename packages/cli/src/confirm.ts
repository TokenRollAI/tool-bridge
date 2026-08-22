import { cancel, confirm, isCancel } from '@clack/prompts'
import { CliError } from './http'

/**
 * 破坏性操作的二次确认(rm 类命令共用)。
 *
 * 设计取舍(刻意不对称,见 CLAUDE.md 的三入口对等纪律与 #70 的"降低 Agent 摩擦"):
 * - **交互式 TTY 且未给 --yes** → 弹 y/N 确认;拒绝或取消则中止(退出码 1)。这是给人的安全网。
 * - **给了 --yes** → 直接放行(脚本显式跳过确认的方式)。
 * - **非 TTY(管道 / CI / Agent 的 --json)** → 直接放行,不追问。
 *   非 TTY 无从弹窗,而强制要求 --yes 会打断所有既有自动化脚本 —— 那正是 #70 抱怨的摩擦。
 *   针对具体误删(如 integration rm 打到 device 节点)的护栏靠服务端/本地 kind 校验,不靠这里。
 *
 * 因此本函数只增强人类交互,不改变脚本既有行为;--yes 在非 TTY 下是无害的显式空操作。
 */
export async function confirmDestructive(
  opts: { yes?: boolean },
  message: string,
): Promise<void> {
  if (opts.yes) return
  if (!process.stdin.isTTY || !process.stderr.isTTY) return
  const accepted = await confirm({ message, initialValue: false })
  if (isCancel(accepted) || !accepted) {
    cancel('已取消')
    throw new CliError('cancelled')
  }
}
