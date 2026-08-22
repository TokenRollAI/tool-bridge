/**
 * 挂载失败的可读诊断 —— 把后端 TBError 的 `code` 翻译成"是哪一类问题 + 下一步怎么办"。
 *
 * 为什么不在这里造 dry-run:后端 `system/registry write` 落库前本就跑完整校验
 * (权限判定 → context/skillhub 的 s3 连通探测 → tool 的 credentialProbe 真实探针),
 * 失败即返回带 code 的 TBError 且不落库。所以"预检"= 包装这次真实 write,把失败按
 * code 归类;而不是另起一条和真实挂载不一致的探测路径。
 *
 * 纯函数,无 React 依赖,可被 Node vitest 断言(本仓姿势)。
 */

import type { TBErrorBody } from '@/lib/types'

export type MountErrorCategory
  = | 'permission'
    | 'credential'
    | 'unreachable'
    | 'config'
    | 'conflict'
    | 'unknown'

export interface MountDiagnosis {
  category: MountErrorCategory
  /** 具体下一步建议(面向操作者)。 */
  hint: string
  /** 是否值得原样重试(网络/上游抖动类)。 */
  retryable: boolean
  /** 一句话说明问题性质。 */
  title: string
}

/** 挂载编排里哪一步失败 —— 影响诊断措辞(凭证写入 vs 挂载探针)。 */
export type MountStage = 'secret' | 'mount' | 'authorize'

interface ErrorLike {
  code?: TBErrorBody['code'] | 'network'
  message?: string
  retryable?: boolean
}

/**
 * 把一次挂载失败翻译成诊断。`stage` 指出失败发生在编排的哪一步:
 * - secret:写凭证就失败(通常是 SK 缺 system/secret admin)。
 * - mount:registry write 失败 —— 可能是权限、配置、或凭证探针(credentialProbe/s3)不通。
 */
export function diagnoseMountError(error: ErrorLike, stage: MountStage): MountDiagnosis {
  const code = error.code ?? 'internal'
  const message = error.message ?? '未知错误'
  const retryable = error.retryable === true

  if (code === 'network') {
    return {
      category: 'unreachable',
      title: '连不上网关',
      hint: '浏览器无法到达网关。检查网络与网关地址;跨域连接还需网关放行 CORS。',
      retryable: true,
    }
  }

  if (code === 'permission_denied') {
    return {
      category: 'permission',
      title: '当前 SK 权限不足',
      hint: stage === 'secret'
        ? '写凭证需要 system/secret 的 admin scope;绑定 authRef 也需要它。换一把有权限的 SK,或让管理员放开。'
        : '挂载需要目标路径的 register scope。到「Secret Key」确认当前 SK 覆盖了这个路径。',
      retryable: false,
    }
  }

  if (code === 'unavailable') {
    // write 阶段的 unavailable 多半是凭证探针/上游连通失败(credentialProbe 或 s3 浅 list)。
    return {
      category: stage === 'mount' ? 'credential' : 'unreachable',
      title: stage === 'mount' ? '凭证或上游连通探测未通过' : '服务暂时不可用',
      hint: stage === 'mount'
        ? '挂载时平台用你填的凭证真实探了一次上游,没通过。检查密钥是否正确、上游地址是否可达、凭证是否有对应权限。'
        : `${message}。可稍后重试。`,
      retryable: true,
    }
  }

  if (code === 'invalid_argument') {
    return {
      category: 'config',
      title: '配置有问题',
      hint: `平台拒绝了这份配置:${message}。回到上一步检查必填字段与格式。`,
      retryable: false,
    }
  }

  if (code === 'conflict') {
    return {
      category: 'conflict',
      title: '与现有状态冲突',
      hint: `${message}。可能是并发修改或路径已被占用。刷新后重试。`,
      retryable: false,
    }
  }

  return {
    category: 'unknown',
    title: '挂载失败',
    hint: message,
    retryable,
  }
}

/** 挂载编排的分步进度(供 UI 渲染可见的 secret→mount→回滚 时间线)。 */
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'rolled-back'

export interface MountStep {
  /** failed 时的诊断。 */
  diagnosis?: MountDiagnosis
  key: 'secret' | 'mount' | 'authorize' | 'rollback'
  label: string
  state: StepState
}

/** 依据本次挂载计划构造初始步骤列表(有没有 secret / 要不要授权决定步骤数)。 */
export function initialMountSteps(plan: {
  hasSecret: boolean
  needsAuthorize: boolean
}): MountStep[] {
  const steps: MountStep[] = []
  if (plan.hasSecret) {
    steps.push({ key: 'secret', label: '写入凭证', state: 'pending' })
  }
  steps.push({ key: 'mount', label: '挂载并预检', state: 'pending' })
  if (plan.needsAuthorize) {
    steps.push({ key: 'authorize', label: '发起授权', state: 'pending' })
  }
  return steps
}
