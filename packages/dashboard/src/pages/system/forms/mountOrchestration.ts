import { useCallback } from 'react'
import { toast } from 'sonner'
import { useInvoke, useOAuthAuthorize, useSecretList } from '@/lib/queries'

/**
 * 挂载编排核心 —— `system/secret/set → system/registry/write`,失败时回滚本轮新建的
 * 孤儿凭证。三个挂载入口(「添加集成」「挂载节点」与向导的 useMountRunner)共用这一份
 * 链路与回滚判据;进度与错误的展示形态由各入口经回调与返回值自渲染。
 *
 * 顺序不可反:挂载时平台会用凭证跑 credentialProbe,先挂载后写凭证则探针必失败。
 */

/** 编排链里会失败的两个阶段(OAuth 授权收尾不在链内,由各入口自理)。 */
export type MountPhase = 'secret' | 'mount'

export interface MountCalls {
  /** `system/registry write` 的完整 args(各入口的 build 函数产出,这里只关心 path)。 */
  mount: { path: string }
  /** 先写的凭证(`system/secret set`);复用已有或无需凭证时省略。 */
  secret?: { name: string, value: string }
}

export interface MountExecuteOptions {
  /**
   * 是否允许失败时回滚凭证。高级挂载器在"替换已有节点"时传 false ——
   * 替换/轮换已有槽时删除会伤及原节点仍引用的同名凭证。
   */
  allowRollback?: boolean
  /** 回滚孤儿凭证的可见进度(即使回滚失败也保留原挂载错误)。 */
  onRollback?: (state: 'running' | 'rolled-back' | 'failed') => void
  /** 各阶段进度(分步 UI 用;failed 时附带原始错误)。 */
  onStage?: (stage: MountPhase, state: 'running' | 'done' | 'failed', error?: Error) => void
}

export type MountExecuteResult
  = | { ok: true }
    | { error: Error, ok: false, stage: MountPhase }

export function useMountOrchestrator() {
  const invoke = useInvoke()
  const secrets = useSecretList()

  const execute = useCallback(
    async (
      calls: MountCalls,
      { allowRollback = true, onRollback, onStage }: MountExecuteOptions = {},
    ): Promise<MountExecuteResult> => {
      // 只有确认"本轮新建"的凭证槽才可在失败时回滚:secret set 是 upsert,
      // 列表未完整加载时不能把"没看到"当成"不存在",否则会误删既有凭证。
      let shouldRollbackSecret = false
      if (calls.secret !== undefined) {
        const known = (secrets.data?.items ?? []).some(item => item.name === calls.secret!.name)
        shouldRollbackSecret = allowRollback
          && secrets.data !== undefined
          && !secrets.hasNextPage
          && !known

        onStage?.('secret', 'running')
        try {
          await invoke.mutateAsync({ commandPath: 'system/secret/set', args: calls.secret })
          onStage?.('secret', 'done')
        } catch (error) {
          onStage?.('secret', 'failed', error as Error)
          return { ok: false, stage: 'secret', error: error as Error }
        }
      }

      onStage?.('mount', 'running')
      try {
        await invoke.mutateAsync({ commandPath: 'system/registry/write', args: calls.mount })
        onStage?.('mount', 'done')
      } catch (error) {
        onStage?.('mount', 'failed', error as Error)
        // 清理本轮新建的孤儿凭证(复用已有凭证不动)。
        if (shouldRollbackSecret && calls.secret !== undefined) {
          onRollback?.('running')
          const removed = await invoke
            .mutateAsync({ commandPath: 'system/secret/delete', args: { name: calls.secret.name } })
            .then(() => true)
            .catch(() => false)
          onRollback?.(removed ? 'rolled-back' : 'failed')
        }
        return { ok: false, stage: 'mount', error: error as Error }
      }

      return { ok: true }
    },
    [invoke, secrets.data, secrets.hasNextPage],
  )

  return { execute, isPending: invoke.isPending }
}

/**
 * OAuth 授权收尾(toast 形态;两个挂载对话框的挂载后引导与 RegistryPage 的授权按钮
 * 共用,向导的分步形态见 useMountRunner):已授权直接确认;拿到授权 URL 就开新页;
 * 上游只允许 localhost 回调时降级提示用对应 CLI 命令(`tb tool auth` /
 * `tb integration auth`)完成。
 */
export function useOAuthFollowUp() {
  const oauth = useOAuthAuthorize()
  const start = (path: string, authCommand: string) =>
    oauth.mutate(path, {
      onSuccess: (result) => {
        if (result.status === 'authorized') {
          toast.success(`${path} 已授权（凭证有效）`)
        } else if (result.authorizationUrl) {
          window.open(result.authorizationUrl, '_blank', 'noopener')
          toast.info('已打开授权页，完成授权后即可调用')
        }
      },
      onError: error =>
        toast.error(
          /redirect/i.test(error.message)
            ? `该上游只允许 localhost 回调，请用 CLI 完成授权：${authCommand} ${path} --local`
            : `发起授权失败：${error.message}`,
        ),
    })
  return { isPending: oauth.isPending, start }
}
