import { useCallback, useState } from 'react'
import type { IntegrationCalls } from '@/pages/system/forms/integrationPlan'
import { useInvalidate, useInvoke, useOAuthAuthorize, useSecretList } from '@/lib/queries'
import { diagnoseMountError, initialMountSteps, type MountStep } from './mountDiagnostics'

export interface MountRunState {
  /** 授权步骤产生的 URL(需用户在新标签完成)。 */
  authorizationUrl: string | null
  mountedPath: string | null
  running: boolean
  steps: MountStep[]
  /** 全部成功后为 true(挂载路径供 UI 展示"打开节点")。 */
  succeeded: boolean
}

const IDLE: MountRunState = {
  steps: [],
  running: false,
  succeeded: false,
  mountedPath: null,
  authorizationUrl: null,
}

/**
 * 挂载编排 runner:把 secret set → registry write → (授权) 这条链路跑成**可见分步**,
 * 失败时按 code 诊断并**可见回滚**本轮新建的孤儿凭证。
 *
 * 复用 IntegrationDialog 既有的 IntegrationCalls(buildIntegrationCalls 的产物,测试锁定),
 * 不改 wire payload —— 只是把原本藏在代码里的 shouldDeleteOnFailure/回滚变成用户看得见的步骤。
 */
export function useMountRunner() {
  const invoke = useInvoke()
  const oauth = useOAuthAuthorize()
  const invalidate = useInvalidate()
  const secrets = useSecretList()
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

      // 只有确认"本轮新建"的凭证槽才可在失败时回滚:secret set 是 upsert,
      // 列表未完整加载时不能把"没看到"当成"不存在",否则会误删既有凭证。
      let shouldRollbackSecret = false
      if (hasSecret) {
        const known = (secrets.data?.items ?? []).some(item => item.name === calls.secret!.name)
        shouldRollbackSecret = secrets.data !== undefined && !secrets.hasNextPage && !known

        patchStep('secret', { state: 'running' })
        try {
          await invoke.mutateAsync({ commandPath: 'system/secret/set', args: calls.secret })
          patchStep('secret', { state: 'done' })
        } catch (error) {
          patchStep('secret', {
            state: 'failed',
            diagnosis: diagnoseMountError(error as { code?: never }, 'secret'),
          })
          setState(prev => ({ ...prev, running: false }))
          return
        }
      }

      patchStep('mount', { state: 'running' })
      try {
        await invoke.mutateAsync({ commandPath: 'system/registry/write', args: calls.mount })
        patchStep('mount', { state: 'done' })
      } catch (error) {
        patchStep('mount', {
          state: 'failed',
          diagnosis: diagnoseMountError(error as { code?: never }, 'mount'),
        })
        // 可见回滚:清理本轮新建的孤儿凭证(复用已有凭证不动)。
        if (shouldRollbackSecret && calls.secret !== undefined) {
          setState(prev => ({
            ...prev,
            steps: [
              ...prev.steps,
              { key: 'rollback', label: '回滚:清理本轮新建的凭证', state: 'running' },
            ],
          }))
          const removed = await invoke
            .mutateAsync({ commandPath: 'system/secret/delete', args: { name: calls.secret.name } })
            .then(() => true)
            .catch(() => false)
          patchStep('rollback', { state: removed ? 'rolled-back' : 'failed' })
        }
        setState(prev => ({ ...prev, running: false }))
        return
      }

      await invalidate()

      if (calls.needsAuthorize) {
        patchStep('authorize', { state: 'running' })
        try {
          const result = await oauth.mutateAsync(calls.mount.path)
          if (result.status === 'authorized') {
            patchStep('authorize', { state: 'done' })
          } else if (result.authorizationUrl) {
            patchStep('authorize', { state: 'done' })
            setState(prev => ({ ...prev, authorizationUrl: result.authorizationUrl ?? null }))
          }
        } catch (error) {
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
    [invoke, oauth, invalidate, secrets.data, secrets.hasNextPage],
  )

  return { state, run, reset }
}
