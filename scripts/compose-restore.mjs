#!/usr/bin/env node
import { Command } from 'commander'
import { portNumber, projectName, restoreCompose } from './compose-snapshot.mjs'

const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort())
const command = new Command().name('compose-restore').description('校验后恢复到明确指定的隔离 Compose project')
  .requiredOption('--project <name>', '目标隔离 project；不能与源或默认 tool-bridge 相同', projectName)
  .requiredOption('--from <directory>', '备份目录')
  .requiredOption('--replace', '明确授权替换该目标项目的五个持久卷')
  .option('--port <port>', '新项目 loopback 端口；缺省随机分配', portNumber)
  .action(async (options) => {
    const result = await restoreCompose({ ...options, signal: controller.signal })
    console.log(`恢复完成：${result.baseUrl}（实例 ${result.instanceId}）`)
  })
try {
  await command.parseAsync()
} catch (error) {
  console.error(`恢复失败：${error.message}`)
  process.exitCode = 1
}
