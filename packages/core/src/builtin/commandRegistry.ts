/** HTBP 通用命令注册表的 builtin 模块装配层。 */

import type { BuiltinDispatchRuntime, BuiltinModule } from './types'
import type { InputSchemaLike } from '../operation/registry'
import type { CallContext, TreePath } from '../types'
import {
  type HtbpCommandHandler,
  HtbpCommandRegistry,
  type HtbpCommandSpec,
} from '../operation/htbpCommandRegistry'
import { TBError } from '../errors'

/** handler 的第二参:稳定依赖 + 请求身份 + 宿主运行时信息。 */
export interface BuiltinCommandContext<TDeps> {
  call: CallContext
  deps: TDeps
  runtime?: BuiltinDispatchRuntime
}

export type BuiltinCommandSpec<S extends InputSchemaLike | undefined = undefined>
  = HtbpCommandSpec<S>

export type BuiltinCommandHandler<
  S extends InputSchemaLike | undefined,
  TDeps,
> = HtbpCommandHandler<S, BuiltinCommandContext<TDeps>>

/** 绑定 module 名、描述和宿主依赖，底层命令定义由通用注册表持有。 */
export class BuiltinCommandRegistry<TDeps>
  extends HtbpCommandRegistry<BuiltinCommandContext<TDeps>> {
  constructor(
    private readonly moduleName: string,
    private readonly moduleDescription: string,
  ) {
    super()
  }

  help(nodePath: TreePath) {
    return this.helpModel({
      path: nodePath,
      kind: 'builtin',
      description: this.moduleDescription,
    })
  }

  /** 绑定依赖后生成现有 BuiltinModule 接口。 */
  module(deps: TDeps): BuiltinModule {
    return {
      module: this.moduleName,
      description: this.moduleDescription,
      help: nodePath => this.help(nodePath),
      dispatch: async (cmd, args, call, runtime) => {
        // Builtin 的旧契约是未知 cmd → invalid_argument。
        if (!this.has(cmd)) {
          throw new TBError(
            'invalid_argument',
            `unknown cmd '${cmd}' on system/${this.moduleName}`,
          )
        }
        return await this.invoke(cmd, args, { deps, call, runtime })
      },
    }
  }
}
