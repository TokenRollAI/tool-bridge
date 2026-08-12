/**
 * Alt Text Generator AI —— 从 open-connector 迁移的 provider(首批样本之一)。
 *
 * 三个文件的分工在整批迁移里是一致的:
 * - `schema.ts` —— Zod 声明与语义标注,由 `scripts/migrate` 生成、之后归本仓库所有;
 * - `api.ts` —— 业务逻辑,人工机械改写(凭证/出站/错误三处本地化);
 * - `index.ts` —— 装配,把两张表对起来。
 */

import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { altTextGeneratorAiActions } from './schema'
import { generateAltText } from './api'

export type { ProviderEnv as Env }

export function createAltTextGeneratorAiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Alt Text Generator AI',
    actions: altTextGeneratorAiActions,
    handlers: { generate_alt_text: generateAltText },
  })
}

export default createAltTextGeneratorAiPlugin()
