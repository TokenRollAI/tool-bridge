/**
 * FFHub —— 从 open-connector 迁移的 provider(api_key,3 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { createFfmpegTask, getFfmpegTask, listFfmpegTasks } from './api'
import { ffhubActions } from './schema'

export type { ProviderEnv as Env }

export function createFfhubPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'FFHub',
    actions: ffhubActions,
    // 上游的 credentialValidators 打 /status,那个端点没有对应 action;list_ffmpeg_tasks
    // 是唯一只读、无必填入参的调用,同样只需一把可用的 key 就能通。
    credentialProbe: 'list_ffmpeg_tasks',
    handlers: {
      create_ffmpeg_task: createFfmpegTask,
      get_ffmpeg_task: getFfmpegTask,
      list_ffmpeg_tasks: listFfmpegTasks,
    },
  })
}

export default createFfhubPlugin()
