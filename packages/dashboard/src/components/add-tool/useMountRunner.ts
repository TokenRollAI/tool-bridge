import { useCallback, useState } from 'react'
import type { IntegrationCalls } from '@/pages/system/forms/integrationPlan'
import { useMountOrchestrator } from '@/pages/system/forms/mountOrchestration'
import { useInvalidate, useOAuthAuthorize } from '@/lib/queries'
import type { MountCompletion } from './MountCompletion'
import { diagnoseMountError, initialMountSteps, type MountStep } from './mountDiagnostics'

export interface MountRunState {
  authorization: MountCompletion['authorization']
  /** 授权步骤产生的 URL(需用户在新标签完成)。 */
  authorizationUrl: string | null
  mountedPath: string | null
  running: boolean
  steps: MountStep[]
  /** Registry 写入成功，不代表授权完成或已验证所有命令。 */
  succeeded: boolean
}

const IDLE: MountRunState = {
  authorization: 'not-required',
  steps: [],
  running: false,
  succeeded: false,
  mountedPath: null,
  authorizationUrl: null,
}

/**
 * 挂载编排 runner:把 useMountOrchestrator 的 secret set → registry write → (授权)
 * 链路跑成**可见分步**,失败时按 code 诊断并**可见回滚**本轮新建的孤儿凭证。
 *
 * 复用 IntegrationDialog 既有的 IntegrationCalls(buildIntegrationCalls 的产物,测试锁定),
 * 不改 wire payload —— 只是把编排核心的回滚变成用户看得见的步骤。
 */
export function useMountRunner() {
  const orchestrator = useMountOrchestrator()
  const oauth = useOAuthAuthorize()
  const invalidate = useInvalidate()
  const [state, setState] = useState<MountRunState>(IDLE)

  const reset = useCallback(() => setState(IDLE), [])

  const patchStep = (key: MountStep['key'], patch: Partial<MountStep>) =>
    setState(prev => ({
      ...prev,
      steps: prev.steps.map(step => (step.key === key ? { ...step, ...patch } : step)),
    }))

  const run = useCallback(
    async (calls: IntegrationCalls) => {
      const hasSecret = calls.secret !== undefined
      setState({
        ...IDLE,
        running: true,
        steps: initialMountSteps({ hasSecret, needsAuthorize: calls.needsAuthorize }),
      })

      const result = await orchestrator.execute(calls, {
        onStage: (stage, stepState, error) =>
          patchStep(stage, stepState === 'failed'
            ? {
                state: 'failed',
                diagnosis: diagnoseMountError((error ?? {}) as { code?: never }, stage),
              }
            : { state: stepState }),
        onRollback: (rollbackState) => {
          if (rollbackState === 'running') {
            setState(prev => ({
              ...prev,
              steps: [
                ...prev.steps,
                { key: 'rollback', label: '回滚:清理本轮新建的凭证', state: 'running' },
              ],
            }))
          } else {
            patchStep('rollback', { state: rollbackState })
          }
        },
      })
      if (!result.ok) {
        setState(prev => ({ ...prev, running: false }))
        return
      }

      await invalidate()

      if (calls.needsAuthorize) {
        setState(prev => ({ ...prev, authorization: 'pending' }))
        patchStep('authorize', { state: 'running' })
        try {
          const auth = await oauth.mutateAsync(calls.mount.path)
          if (auth.status === 'authorized') {
            setState(prev => ({ ...prev, authorization: 'authorized' }))
            patchStep('authorize', { state: 'done' })
          } else if (auth.authorizationUrl) {
            patchStep('authorize', { state: 'done' })
            setState(prev => ({ ...prev, authorizationUrl: auth.authorizationUrl ?? null }))
          } else {
            patchStep('authorize', { state: 'pending' })
          }
        } catch (error) {
          setState(prev => ({ ...prev, authorization: 'failed' }))
          // 授权失败不回滚挂载:节点已挂好,授权可稍后在节点上重试。
          patchStep('authorize', {
            state: 'failed',
            diagnosis: diagnoseMountError(error as { code?: never }, 'authorize'),
          })
        }
      }

      setState(prev => ({
        ...prev,
        running: false,
        succeeded: true,
        mountedPath: calls.mount.path,
      }))
    },
    [orchestrator, oauth, invalidate],
  )

  return { state, run, reset }
}
