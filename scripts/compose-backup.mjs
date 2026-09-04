#!/usr/bin/env node
import { Command } from 'commander'
import { backupCompose, projectName } from './compose-snapshot.mjs'

const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort())
const command = new Command().name('compose-backup').description('停止默认 Compose 的写入方并备份全部五个持久卷')
  .requiredOption('--project <name>', '已有源 Compose project', projectName)
  .requiredOption('--out <directory>', '新建的备份目录；拒绝覆盖已有目录')
  .action(async (options) => {
    const result = await backupCompose({ ...options, signal: controller.signal })
    console.log(`备份完成：${result.directory}`)
  })
try {
  await command.parseAsync()
} catch (error) {
  console.error(`备份失败：${error.message}`)
  process.exitCode = 1
}
