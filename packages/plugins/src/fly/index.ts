/**
 * Fly.io —— 从 open-connector 迁移的 provider(api_key,9 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 不声明 `credentialProbe`:上游 `validateFlyCredential` 打的 `tokens/current` 没有对应
 * action,而九个 action 里没有一个是"只读且无必填入参"的(list_apps 要 org_slug、
 * 其余都要 app_name),硬凑一个会让探针失败看起来像凭证问题。
 */

import {
  createMachine,
  getApp,
  getMachine,
  listApps,
  listMachines,
  restartMachine,
  startMachine,
  stopMachine,
  waitForMachine,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { flyActions } from './schema'

export type { ProviderEnv as Env }

export function createFlyPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Fly.io',
    actions: flyActions,
    handlers: {
      list_apps: listApps,
      get_app: getApp,
      list_machines: listMachines,
      create_machine: createMachine,
      get_machine: getMachine,
      start_machine: startMachine,
      stop_machine: stopMachine,
      restart_machine: restartMachine,
      wait_for_machine: waitForMachine,
    },
  })
}

export default createFlyPlugin()
