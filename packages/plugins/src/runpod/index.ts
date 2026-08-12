/**
 * Runpod —— 从 open-connector 迁移的 provider(api_key,7 个 action,围绕 Pods 生命周期)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import { deletePod, getPod, listPods, resetPod, restartPod, startPod, stopPod } from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { runpodActions } from './schema'

export type { ProviderEnv as Env }

export function createRunpodPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Runpod',
    actions: runpodActions,
    // 上游 credentialValidators 打的就是 /pods —— 只读、无必填入参。
    credentialProbe: 'list_pods',
    handlers: {
      list_pods: listPods,
      get_pod: getPod,
      start_pod: startPod,
      stop_pod: stopPod,
      restart_pod: restartPod,
      reset_pod: resetPod,
      delete_pod: deletePod,
    },
  })
}

export default createRunpodPlugin()
