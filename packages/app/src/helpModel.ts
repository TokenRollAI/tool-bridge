/**
 * 节点 `~help` 的 HelpModel 组装(表现渲染在 responses.ts,内容协商在 core)。
 *
 * 一个出口覆盖全部 kind:builtin 取模块静态声明,directory 列可见子节点,
 * mcp/http/tool 经 Provider 取上游工具集后虚拟化,context/skillhub 走静态动词表
 * (按 provider 自报能力裁剪)。remote 在调用点已透传,不进此函数。
 */
import {
  type BuiltinModule,
  type CallContext,
  contextHelpModel,
  contextMethodsOf,
  deviceDirectoryHelpModel,
  deviceFsHelpModel,
  deviceShellHelpModel,
  type HelpModel,
  isReadOnlyProvider,
  NodeRegistryStore,
  optionalMethodsForCapabilities,
  skillhubHelpModel,
  TBError,
  toolsToHelpModel,
  type TreeNode,
  virtualizeTools,
} from '@tool-bridge/core'
import type { TbAppDeps } from './deps'
import { assertContextAlive, localContext, pruneExpiredContext } from './contextNodes'
import { providerFor, requirePluginExport, upstreamTools } from './toolNodes'
import { deviceMarkerOf, deviceToolMarker } from './deviceNodes'
import { filterListVisible } from './paths'

/**
 * 节点的 HelpModel:builtin 取模块 help();directory 列可见子节点;mcp/http 经 Provider 取
 * 上游工具集(mcp 走缓存,`refresh` 强制刷新)→ 虚拟化 → `toolsToHelpModel`;context 静态
 * cmd 表(ttl 懒回收先行);其余 kind(device)未落地 → 501。remote 在调用点已透传,不进此函数。
 */
export async function helpModelFor(
  node: TreeNode,
  registry: NodeRegistryStore,
  ctx: CallContext,
  builtins: Map<string, BuiltinModule>,
  deps: TbAppDeps,
  opts: { now: string, refresh: boolean },
): Promise<HelpModel> {
  if (node.kind === 'builtin' && node.config?.kind === 'builtin') {
    const mod = builtins.get(node.config.module)
    if (mod) return mod.help(node.path)
    throw TBError.unimplemented(`builtin module '${node.config.module}' not available`)
  }
  if (node.kind === 'directory') {
    const children = filterListVisible(
      await pruneExpiredContext(await registry.children(node.path), registry),
      ctx.scopes,
    )
    if (node.online !== undefined) {
      return deviceDirectoryHelpModel(
        { path: node.path, description: node.description, online: node.online },
        children.map(n => ({ path: n.path, kind: n.kind, description: n.description })),
      )
    }
    return {
      node: { path: node.path, kind: node.kind, description: node.description },
      cmds: [],
      children: children.map(n => ({ path: n.path, kind: n.kind, description: n.description })),
      hint: 'GET /<child-path>/~help describes a child node',
    }
  }
  // device 自定义 tool 节点:~help 来自注册时上送的工具表(cmds),
  // 不打设备;索引形态与 mcp/http 对齐,单工具全量 spec 走工具级 ~help(toolHelpModelFor)。
  const toolMarker = deviceToolMarker(node)
  if (toolMarker !== null) {
    return toolsToHelpModel(
      node.path,
      { kind: node.kind, description: node.description },
      toolMarker.cmds ?? [],
      { index: true },
    )
  }
  if (node.kind === 'mcp' || node.kind === 'http' || node.kind === 'tool') {
    const provider = await providerFor(node, ctx, deps)
    const raw = await upstreamTools(node, provider, deps, opts.refresh, opts.now)
    const { exposed } = virtualizeTools(node.virtualize, raw)
    // 索引形态(两级披露):不含 inputSchema;全量 spec 走工具级 ~help。
    return toolsToHelpModel(
      node.path,
      { kind: node.kind, description: node.description },
      exposed,
      {
        index: true,
      },
    )
  }
  if (node.kind === 'device' && node.config?.kind === 'device') {
    return deviceShellHelpModel(node.path, node.config.expose.shell ?? {})
  }
  // context:cmd 表静态声明(readOnly 隐藏写动词);~help 命中即做 ttl 懒回收。
  if (node.kind === 'context' && node.config?.kind === 'context') {
    await assertContextAlive(node, node.config, registry)
    if (node.config.provider === 'device-fs') {
      return deviceFsHelpModel(
        { path: node.path, description: node.description },
        { readOnly: node.config.readOnly ?? false },
      )
    }
    // device 自定义 context 节点:静态动词表(readOnly 隐藏写动词)。
    if (deviceMarkerOf(node.config.providerConfig) !== null) {
      return contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
    }
    if (node.config.provider !== 'r2' && node.config.provider !== 's3') {
      const local = localContext(deps, node)
      if (local !== null) {
        // SDK 进程内 Provider:动词表 = 真实实现的 handler;无任何写动词即自动只读
        // (挂载期显式 readOnly 仍可额外收紧)。~help 与可调用集合据此始终吻合。
        return contextHelpModel(node, {
          methods: contextMethodsOf(local),
          readOnly: (node.config.readOnly ?? false) || isReadOnlyProvider(local),
        })
      }
      // plugin-backed 节点:动词表 = export 自报的 methods(plugin/v2 契约);未自报则
      // 退回旧默认(四动词 + 注册时声明的可选方法,Q12)。~help 与可调用集合由此始终吻合
      // —— providers/pluginContext.ts 按同一集合挂 handler。
      const model = contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
      const { export: exported } = await requirePluginExport(
        deps.state,
        node.config.provider,
        'context',
        'context',
        node.config.export,
      )
      const declared
        = exported.methods !== undefined
          ? new Set(exported.methods)
          : new Set([
              'List',
              'Get',
              'Write',
              'Update',
              ...optionalMethodsForCapabilities(exported.capabilities ?? []),
            ])
      return { ...model, cmds: model.cmds.filter(c => declared.has(c.name)) }
    }
    return contextHelpModel(node, { readOnly: node.config.readOnly ?? false })
  }
  if (node.kind === 'skillhub' && node.config?.kind === 'skillhub') {
    await assertContextAlive(node, node.config, registry)
    return skillhubHelpModel(node, { readOnly: node.config.readOnly ?? false })
  }
  throw TBError.unimplemented(`~help for kind '${node.kind}' not implemented yet`)
}
