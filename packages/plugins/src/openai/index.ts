/**
 * OpenAI —— 从 open-connector 迁移的 provider(api_key,15 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  cancelBatch,
  createAudioTranscription,
  createAudioTranslation,
  createBatch,
  createEmbeddings,
  createImage,
  createModeration,
  createResponse,
  createSpeech,
  getBatch,
  getInputTokenCounts,
  getModel,
  getResponse,
  listInputItems,
  listModels,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { openaiActions } from './schema'

export type { ProviderEnv as Env }

export function createOpenaiPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'OpenAI',
    actions: openaiActions,
    // 上游 credentialValidators 也打 /models —— 只读、无必填入参,正好当挂载时的凭证探针。
    credentialProbe: 'list_models',
    handlers: {
      list_models: listModels,
      get_model: getModel,
      create_response: createResponse,
      get_response: getResponse,
      list_input_items: listInputItems,
      get_input_token_counts: getInputTokenCounts,
      create_embeddings: createEmbeddings,
      create_moderation: createModeration,
      create_image: createImage,
      create_speech: createSpeech,
      create_audio_transcription: createAudioTranscription,
      create_audio_translation: createAudioTranslation,
      create_batch: createBatch,
      get_batch: getBatch,
      cancel_batch: cancelBatch,
    },
  })
}

export default createOpenaiPlugin()
