/**
 * HTBP 命令的通用注册层。
 *
 * 一条 register 同时定义 Help metadata、scope、strict Zod 入参和 handler；
 * builtin/context/skillhub 只负责绑定各自的调用上下文与能力裁剪。
 */

import { z } from 'zod/v4'
import type { Action, NodeKind, TreePath } from '../types'
import type { CmdSpec, HelpModel } from '../htbp/model'
import {
  type InferInput,
  type InputSchemaLike,
  OperationRegistry,
  type OperationSpec,
} from './registry'
import { TBError } from '../errors'

/** 通用分页入参；未知嵌套字段不得被静默忽略。 */
export const HTBP_LIST_OPTIONS_SCHEMA = z.strictObject({
  cursor: z.string().optional().describe('opaque cursor returned by the previous page'),
  limit: z.number().optional().describe('page size (default 50, max 200)'),
}).describe('pagination options')

export interface HtbpCommandSpec<S extends InputSchemaLike | undefined = undefined>
  extends Omit<OperationSpec<S>, 'description' | 'rawInputSchema'> {
  h: string
  returns?: string
  scope: Action
}

export type HtbpCommandHandler<
  S extends InputSchemaLike | undefined,
  TContext,
> = (
  input: InferInput<S>,
  context: TContext,
) => unknown | Promise<unknown>

interface CommandMetadata {
  returns?: string
  scope: Action
}

/** 与节点 kind/宿主无关的命令注册表。 */
export class HtbpCommandRegistry<TContext> {
  private readonly metadata = new Map<string, CommandMetadata>()
  private readonly operations = new OperationRegistry<TContext>()

  register<S extends InputSchemaLike | undefined = undefined>(
    name: string,
    spec: HtbpCommandSpec<S>,
    handler: HtbpCommandHandler<S, TContext>,
  ): this {
    const { h, returns, scope, ...operationSpec } = spec
    this.operations.register(
      name,
      { ...operationSpec, description: h } as OperationSpec<S>,
      handler,
    )
    this.metadata.set(name, {
      scope,
      ...(returns !== undefined ? { returns } : {}),
    })
    return this
  }

  names(): string[] {
    return this.operations.names()
  }

  has(name: string): boolean {
    return this.operations.has(name)
  }

  scopeFor(name: string): Action | undefined {
    return this.metadata.get(name)?.scope
  }

  commandSpecs(nodePath: TreePath): CmdSpec[] {
    return this.operations.list().map((operation) => {
      const metadata = this.metadata.get(operation.name)
      if (metadata === undefined) {
        throw new TBError('internal', `HTBP command metadata missing: '${operation.name}'`)
      }
      return {
        name: operation.name,
        method: 'POST',
        path: `/${nodePath}/${operation.name}`,
        scope: metadata.scope,
        ...(operation.description !== undefined ? { h: operation.description } : {}),
        ...(operation.inputSchema !== undefined ? { inputSchema: operation.inputSchema } : {}),
        ...(operation.outputSchema !== undefined ? { outputSchema: operation.outputSchema } : {}),
        ...(operation.effect !== undefined ? { effect: operation.effect } : {}),
        ...(operation.confirm !== undefined ? { confirm: operation.confirm } : {}),
        ...(metadata.returns !== undefined ? { returns: metadata.returns } : {}),
      }
    })
  }

  command(name: string, nodePath: TreePath): CmdSpec | undefined {
    return this.commandSpecs(nodePath).find(command => command.name === name)
  }

  helpModel(
    node: { description: string, kind: NodeKind, path: TreePath },
    include: (command: CmdSpec) => boolean = () => true,
  ): HelpModel {
    return {
      node,
      cmds: this.commandSpecs(node.path).filter(include),
    }
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
    context: TContext,
  ): Promise<unknown> {
    return await this.operations.invoke(name, args, context)
  }

  /** 校验/规范化宿主将转发到另一执行通道的命令入参。 */
  parse(name: string, args: Record<string, unknown>): unknown {
    return this.operations.parse(name, args)
  }
}
