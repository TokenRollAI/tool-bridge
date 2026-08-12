/**
 * Mistral AI 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listModelsInput = z.strictObject({}).describe('No input parameters are required for this action.')

export const listModelsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getModelInput = z.looseObject({
  model_id: z.string().min(1).describe('Model ID.'),
}).describe('Get one model.')

export const getModelOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listConversationsInput = z.looseObject({
  page: z.int().min(0).describe('Page number, starting from 0.').optional(),
  page_size: z.int().min(1).describe('The number of items returned per page.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
}).describe('Lists conversations with pagination and metadata filters.')

export const listConversationsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const startConversationInput = z.looseObject({
  inputs: z.union([z.string().describe('Plain text input.'), z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.')).describe('Structured input entries.')]).describe('Conversation initial input.'),
  stream: z.boolean().describe('Whether to use streaming responses. This connector only supports false or omitted.').optional(),
  store: z.boolean().describe('Whether to persist the conversation.').optional(),
  handoff_execution: z.enum(['client', 'server']).describe('Handoff execution method.').optional(),
  instructions: z.string().describe('Conversation-level instructions.').optional(),
  tools: z.array(z.looseObject({}).describe('Tool definition accepted by Mistral.')).describe('Tools available for this conversation.').optional(),
  completion_args: z.looseObject({}).describe('Completion parameter configuration accepted by Mistral.').optional(),
  guardrails: z.array(z.looseObject({}).describe('Guardrail configuration accepted by Mistral.')).describe('Guardrails to apply.').optional(),
  name: z.string().describe('Conversation name.').optional(),
  description: z.string().describe('Conversation description.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
  agent_id: z.string().min(1).describe('Agent ID.').optional(),
  agent_version: z.union([z.string().min(1).describe('Version alias.'), z.int()]).describe('Version number or version alias.').optional(),
  model: z.string().describe('Direct model identifier to use.').optional(),
}).describe('Input parameters for creating a conversation.')

export const startConversationOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getConversationInput = z.looseObject({
  conversation_id: z.string().min(1).describe('Conversation ID.'),
}).describe('Get one conversation.')

export const getConversationOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const deleteConversationInput = z.looseObject({
  conversation_id: z.string().min(1).describe('Conversation ID.'),
}).describe('Delete one conversation.')

export const deleteConversationOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the resource has been deleted.'),
}).describe('Delete action response.')

export const appendToConversationInput = z.looseObject({
  conversation_id: z.string().min(1).describe('Conversation ID.'),
  inputs: z.union([z.string().describe('Plain text input.'), z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.')).describe('Structured input entries.')]).describe('Input to append to the conversation.'),
  completion_args: z.looseObject({}).describe('Completion parameter configuration accepted by Mistral.').optional(),
  handoff_execution: z.enum(['client', 'server']).describe('Handoff execution method.').optional(),
  store: z.boolean().describe('Whether to persist storage.').optional(),
  tool_confirmations: z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.')).describe('Tool call confirmations.').optional(),
}).describe('Input parameters for appending content to a conversation.')

export const appendToConversationOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getConversationHistoryInput = z.looseObject({
  conversation_id: z.string().min(1).describe('Conversation ID.'),
}).describe('Get conversation history.')

export const getConversationHistoryOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getConversationMessagesInput = z.looseObject({
  conversation_id: z.string().min(1).describe('Conversation ID.'),
}).describe('Get conversation messages.')

export const getConversationMessagesOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const restartConversationInput = z.looseObject({
  conversation_id: z.string().min(1).describe('Conversation ID.'),
  from_entry_id: z.string().min(1).describe('Entry ID to restart from.'),
  inputs: z.union([z.string().describe('Plain text input.'), z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.')).describe('Structured input entries.')]).describe('Input to continue after restarting.').optional(),
  completion_args: z.looseObject({}).describe('Completion parameter configuration accepted by Mistral.').optional(),
  handoff_execution: z.enum(['client', 'server']).describe('Handoff execution method.').optional(),
  guardrails: z.array(z.looseObject({}).describe('Guardrail configuration accepted by Mistral.')).describe('Guardrails to apply.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
  store: z.boolean().describe('Whether to persist storage.').optional(),
  stream: z.boolean().describe('Whether to use streaming responses. This connector only supports false or omitted.').optional(),
  agent_version: z.union([z.string().min(1).describe('Version alias.'), z.int()]).describe('Version number or version alias.').optional(),
}).describe('Input parameters for restarting a conversation.')

export const restartConversationOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listAgentsInput = z.looseObject({
  page: z.int().min(0).describe('Page number, starting from 0.').optional(),
  page_size: z.int().min(1).describe('The number of items returned per page.').optional(),
  deployment_chat: z.boolean().describe('Whether to return only deployment_chat agents.').optional(),
  sources: z.array(z.string().min(1)).min(1).describe('A list of strings.').optional(),
  name: z.string().describe('Filter by agent name.').optional(),
  search: z.string().describe('Search by name or ID.').optional(),
  id: z.string().describe('Filter by exact agent ID.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
}).describe('List agents with pagination and filters.')

export const listAgentsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createAgentInput = z.looseObject({
  model: z.string().min(1).describe('The default model used by the agent.'),
  name: z.string().min(1).describe('Agent name.'),
  instructions: z.string().describe('Agent instructions.').optional(),
  tools: z.array(z.looseObject({}).describe('Tool definition accepted by Mistral.')).describe('Tools available to the agent.').optional(),
  completion_args: z.looseObject({}).describe('Completion parameter configuration accepted by Mistral.').optional(),
  guardrails: z.array(z.looseObject({}).describe('Guardrail configuration accepted by Mistral.')).describe('Guardrails to apply.').optional(),
  description: z.string().describe('Agent description.').optional(),
  handoffs: z.array(z.string().min(1)).min(1).describe('A list of strings.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
  version_message: z.string().describe('Version message for this update.').optional(),
}).describe('Create a Mistral agent.')

export const createAgentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getAgentInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
  agent_version: z.union([z.string().min(1).describe('Version alias.'), z.int()]).describe('Version number or version alias.').optional(),
}).describe('Get an agent.')

export const getAgentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const updateAgentInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
  model: z.string().describe('Updated model.').optional(),
  name: z.string().describe('Updated agent name.').optional(),
  instructions: z.string().describe('Updated instructions.').optional(),
  tools: z.array(z.looseObject({}).describe('Tool definition accepted by Mistral.')).describe('Updated tool list.').optional(),
  completion_args: z.looseObject({}).describe('Completion parameter configuration accepted by Mistral.').optional(),
  guardrails: z.array(z.looseObject({}).describe('Guardrail configuration accepted by Mistral.')).describe('Guardrails to apply.').optional(),
  description: z.string().describe('Updated description.').optional(),
  handoffs: z.array(z.string().min(1)).min(1).describe('A list of strings.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
  deployment_chat: z.boolean().describe('Whether to enable deployment chat.').optional(),
  version_message: z.string().describe('Version message for this update.').optional(),
}).describe('Update a Mistral agent and create a new version.')

export const updateAgentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const deleteAgentInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
}).describe('Delete one agent.')

export const deleteAgentOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the resource has been deleted.'),
}).describe('Delete action response.')

export const updateAgentVersionInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
  version: z.int().describe('The target version number.'),
}).describe('Update the current agent version.')

export const updateAgentVersionOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listAgentVersionsInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
  page: z.int().min(0).describe('Page number, starting from 0.').optional(),
  page_size: z.int().min(1).describe('The number of items returned per page.').optional(),
}).describe('List versions for an agent.')

export const listAgentVersionsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getAgentVersionInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
  version: z.union([z.string().min(1).describe('Version alias.'), z.int()]).describe('Version number or version alias.'),
}).describe('Get one agent version.')

export const getAgentVersionOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createOrUpdateAgentAliasInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
  alias: z.string().min(1).describe('Agent alias name.'),
  version: z.int().describe('Version number.'),
}).describe('Create or update an agent alias.')

export const createOrUpdateAgentAliasOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listAgentAliasesInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
}).describe('List agent aliases.')

export const listAgentAliasesOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createChatCompletionInput = z.looseObject({
  model: z.string().min(1).describe('Model ID.'),
  messages: z.array(z.looseObject({}).describe('A chat message accepted by Mistral.')).min(1).describe('List of chat messages.'),
  temperature: z.number().min(0).max(1.5).describe('Sampling temperature.').optional(),
  top_p: z.number().min(0).max(1).describe('Nucleus sampling threshold.').optional(),
  max_tokens: z.int().min(0).describe('The maximum number of generated tokens.').optional(),
  stream: z.boolean().describe('Whether to use streaming responses. This connector only supports false or omitted.').optional(),
  stop: z.union([z.string().describe('Single stop word.'), z.array(z.string().min(1)).min(1).describe('A list of strings.')]).describe('Stop generating conditions.').optional(),
  random_seed: z.int().min(0).describe('Random seed.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
  response_format: z.looseObject({}).describe('Response format configuration accepted by Mistral.').optional(),
  tools: z.array(z.looseObject({}).describe('Tool definition accepted by Mistral.')).describe('Tools available for the request.').optional(),
  tool_choice: z.unknown().describe('Tool calling strategy.').optional(),
  presence_penalty: z.number().min(-2).max(2).describe('Presence penalty.').optional(),
  frequency_penalty: z.number().min(-2).max(2).describe('Frequency penalty.').optional(),
  n: z.int().min(1).describe('Number of candidates.').optional(),
  prediction: z.looseObject({}).describe('Predictive optimization configuration.').optional(),
  parallel_tool_calls: z.boolean().describe('Whether to enable parallel tool invocation.').optional(),
  prompt_mode: z.string().describe('Prompt mode.').optional(),
  reasoning_effort: z.enum(['high', 'none']).describe('Reasoning strength.').optional(),
  guardrails: z.array(z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.')).describe('Guardrail configurations.').optional(),
  safe_prompt: z.boolean().describe('Whether to inject safety prompts.').optional(),
}).describe('Input parameters for chat completion.')

export const createChatCompletionOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createFimCompletionInput = z.looseObject({
  model: z.string().min(1).describe('Model ID.'),
  prompt: z.string().describe('The prefix content to complete.'),
  suffix: z.string().describe('Completed suffix context.').optional(),
  temperature: z.number().min(0).max(1.5).describe('Sampling temperature.').optional(),
  top_p: z.number().min(0).max(1).describe('Nucleus sampling threshold.').optional(),
  max_tokens: z.int().min(0).describe('The maximum number of generated tokens.').optional(),
  min_tokens: z.int().min(0).describe('Minimum number of generated tokens.').optional(),
  stream: z.boolean().describe('Whether to use streaming responses. This connector only supports false or omitted.').optional(),
  stop: z.union([z.string().describe('Single stop word.'), z.array(z.string().min(1)).min(1).describe('A list of strings.')]).describe('Stop generating conditions.').optional(),
  random_seed: z.int().min(0).describe('Random seed.').optional(),
}).describe('Input parameters for FIM completion.')

export const createFimCompletionOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createAgentsCompletionInput = z.looseObject({
  agent_id: z.string().min(1).describe('Agent ID.'),
  messages: z.array(z.looseObject({}).describe('A chat message accepted by Mistral.')).min(1).describe('Messages sent to the agent.'),
  temperature: z.number().min(0).max(1.5).describe('Sampling temperature.').optional(),
  top_p: z.number().min(0).max(1).describe('Nucleus sampling threshold.').optional(),
  max_tokens: z.int().min(0).describe('The maximum number of generated tokens.').optional(),
  stream: z.boolean().describe('Whether to use streaming responses. This connector only supports false or omitted.').optional(),
  stop: z.union([z.string().describe('Single stop word.'), z.array(z.string().min(1)).min(1).describe('A list of strings.')]).describe('Stop generating conditions.').optional(),
  random_seed: z.int().min(0).describe('Random seed.').optional(),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
  response_format: z.looseObject({}).describe('Response format configuration accepted by Mistral.').optional(),
  tools: z.array(z.looseObject({}).describe('Tool definition accepted by Mistral.')).describe('Tools added in this request.').optional(),
  tool_choice: z.unknown().describe('Tool calling strategy.').optional(),
  presence_penalty: z.number().min(-2).max(2).describe('Presence penalty.').optional(),
  frequency_penalty: z.number().min(-2).max(2).describe('Frequency penalty.').optional(),
  n: z.int().min(1).describe('Number of candidates.').optional(),
  prediction: z.looseObject({}).describe('Predictive optimization configuration.').optional(),
  parallel_tool_calls: z.boolean().describe('Whether to enable parallel tool invocation.').optional(),
  prompt_mode: z.string().describe('Prompt mode.').optional(),
  reasoning_effort: z.enum(['high', 'none']).describe('Reasoning strength.').optional(),
}).describe('Input parameters for agent completion.')

export const createAgentsCompletionOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createEmbeddingsInput = z.looseObject({
  model: z.string().min(1).describe('Model ID.'),
  input: z.union([z.string().describe('Single text.'), z.array(z.string().min(1)).min(1).describe('A list of strings.')]).describe('Text to embed.'),
  metadata: z.record(z.string(), z.unknown().describe('Any JSON value accepted by the Mistral API.')).describe('Any JSON object accepted by the Mistral API.').optional(),
  output_dimension: z.int().min(1).describe('Output vector dimensions.').optional(),
  output_dtype: z.enum(['float', 'int8', 'uint8', 'binary', 'ubinary']).describe('Output vector data type.').optional(),
  encoding_format: z.enum(['float', 'base64']).describe('Vector encoding format.').optional(),
}).describe('Generate embeddings.')

export const createEmbeddingsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createModerationInput = z.looseObject({
  model: z.string().min(1).describe('Model ID.'),
  input: z.union([z.string().describe('Single text.'), z.array(z.string().min(1)).min(1).describe('A list of strings.')]).describe('Text pending review.'),
}).describe('Moderate text.')

export const createModerationOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createChatModerationInput = z.looseObject({
  model: z.string().min(1).describe('Model ID.'),
  input: z.union([z.array(z.looseObject({}).describe('A chat message accepted by Mistral.')).describe('Messages for a single chat session.'), z.array(z.array(z.looseObject({}).describe('A chat message accepted by Mistral.')).describe('A chat session.')).describe('Multiple chat sessions.')]).describe('Chat content pending review.'),
}).describe('Moderate chat messages.')

export const createChatModerationOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createOcrInput = z.looseObject({
  model: z.string().min(1).describe('Model ID.'),
  id: z.string().describe('Custom ID for this OCR request.').optional(),
  document: z.looseObject({}).describe('OCR document or image reference accepted by Mistral.'),
  pages: z.array(z.int().min(0).describe('Page number, starting from 0.')).describe('Only process specified pages.').optional(),
  include_image_base64: z.boolean().describe('Whether to include extracted image base64 data.').optional(),
  image_limit: z.int().describe('Maximum number of images to extract.').optional(),
  image_min_size: z.int().describe('Minimum image size to extract.').optional(),
  bbox_annotation_format: z.looseObject({}).describe('Response format configuration accepted by Mistral.').optional(),
  document_annotation_format: z.looseObject({}).describe('Response format configuration accepted by Mistral.').optional(),
  document_annotation_prompt: z.string().describe('Prompt for structured document extraction.').optional(),
  confidence_scores_granularity: z.enum(['word', 'page']).describe('Confidence granularity.').optional(),
  table_format: z.enum(['markdown', 'html']).describe('Table output format.').optional(),
  extract_header: z.boolean().describe('Whether to extract the header.').optional(),
  extract_footer: z.boolean().describe('Whether to extract the footer.').optional(),
  bbox_annotation_format_prompt: z.string().describe('Prompt for bbox structured extraction.').optional(),
  document_annotation_prompt_extra: z.string().describe('Additional document prompt words.').optional(),
}).describe('Input parameters for OCR.')

export const createOcrOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createAudioTranscriptionInput = z.looseObject({
  file: z.union([z.strictObject({
    fileId: z.string().min(1).describe('The transit file identifier returned by POST /api/files.'),
    name: z.string().min(1).describe('Optional filename override to send to the provider.').optional(),
    mimeType: z.string().min(1).describe('Optional MIME type override to send to the provider.').optional(),
  }).describe('A file previously uploaded to the local transit file API.'), z.strictObject({
    name: z.string().min(1).describe('The filename to send to Mistral.'),
    mimeType: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    mimetype: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    url: z.url().describe('A public HTTP or HTTPS URL that the connector can fetch and upload.'),
  }).describe('A public URL upload source.'), z.strictObject({
    name: z.string().min(1).describe('The filename to send to Mistral.'),
    mimeType: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    mimetype: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    content_base64: z.string().min(1).describe('Base64-encoded file content.'),
  }).describe('A base64 upload source.')]).describe('File content to upload to Mistral.').optional(),
  file_id: z.string().min(1).describe('File ID.').optional(),
  context_bias: z.array(z.string().describe('Bias phrase.')).describe('Context bias phrases.').optional(),
  diarize: z.boolean().describe('Whether to diarize speakers.').optional(),
  language: z.string().describe('Audio language code.').optional(),
  model: z.string().min(1).describe('Model ID.'),
  temperature: z.number().describe('Sampling temperature.').optional(),
  timestamp_granularities: z.array(z.enum(['segment', 'word']).describe('Timestamp granularity.')).describe('Timestamp granularities to include.').optional(),
}).describe('Input parameters for audio transcription.')

export const createAudioTranscriptionOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listFilesInput = z.looseObject({
  after: z.string().describe('The previous page cursor file ID.').optional(),
  limit: z.int().min(1).describe('Maximum number of files.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort direction.').optional(),
}).describe('List files.')

export const listFilesOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const uploadFileInput = z.looseObject({
  file: z.union([z.strictObject({
    fileId: z.string().min(1).describe('The transit file identifier returned by POST /api/files.'),
    name: z.string().min(1).describe('Optional filename override to send to the provider.').optional(),
    mimeType: z.string().min(1).describe('Optional MIME type override to send to the provider.').optional(),
  }).describe('A file previously uploaded to the local transit file API.'), z.strictObject({
    name: z.string().min(1).describe('The filename to send to Mistral.'),
    mimeType: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    mimetype: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    url: z.url().describe('A public HTTP or HTTPS URL that the connector can fetch and upload.'),
  }).describe('A public URL upload source.'), z.strictObject({
    name: z.string().min(1).describe('The filename to send to Mistral.'),
    mimeType: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    mimetype: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    content_base64: z.string().min(1).describe('Base64-encoded file content.'),
  }).describe('A base64 upload source.')]).describe('File content to upload to Mistral.'),
  purpose: z.string().describe('File usage, such as fine-tune, batch, or ocr.').optional(),
  visibility: z.string().describe('File visibility, such as workspace or user.').optional(),
  expiry: z.int().describe('The number of hours before the file expires.').optional(),
}).describe('Upload a file to Mistral.')

export const uploadFileOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const retrieveFileInput = z.looseObject({
  file_id: z.string().min(1).describe('File ID.'),
}).describe('Retrieve file metadata.')

export const retrieveFileOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const deleteFileInput = z.looseObject({
  file_id: z.string().min(1).describe('File ID.'),
}).describe('Delete one file.')

export const deleteFileOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const downloadFileInput = z.looseObject({
  file_id: z.string().min(1).describe('File ID.'),
}).describe('Download one file.')

export const downloadFileOutput = z.strictObject({
  content: z.strictObject({
    fileId: z.string().min(1).describe('The local transit file identifier.'),
    downloadUrl: z.url().describe('The local transit download URL.'),
    sizeBytes: z.int().min(0).describe('The stored file size in bytes.'),
    name: z.string().min(1).describe('The downloaded filename.'),
    mimeType: z.string().min(1).describe('The downloaded file MIME type.'),
  }).describe('Downloaded file content.'),
}).describe('The output of the file download action.')

export const getFileSignedUrlInput = z.looseObject({
  file_id: z.string().min(1).describe('File ID.'),
  expiry: z.int().min(1).describe('The number of hours the signed link remains valid.').optional(),
}).describe('Get a file signed URL.')

export const getFileSignedUrlOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getFineTuningJobsInput = z.looseObject({
  page: z.int().min(0).describe('Page number, starting from 0.').optional(),
  page_size: z.int().min(1).describe('The number of items returned per page.').optional(),
  model: z.string().describe('Filter by base model.').optional(),
  status: z.string().describe('Filter by task status.').optional(),
  suffix: z.string().describe('Filter by model suffix.').optional(),
  wandb_name: z.string().describe('Filter by Weights & Biases run name.').optional(),
  wandb_project: z.string().describe('Filter by Weights & Biases project.').optional(),
  created_after: z.string().describe('Only tasks created after this time are returned.').optional(),
  created_before: z.string().describe('Only tasks created before this time are returned.').optional(),
  created_by_me: z.boolean().describe('Whether to return only tasks created by the current caller.').optional(),
}).describe('List fine-tuning jobs.')

export const getFineTuningJobsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listBatchJobsInput = z.looseObject({
  page: z.int().min(0).describe('Page number, starting from 0.').optional(),
  page_size: z.int().min(1).describe('The number of items returned per page.').optional(),
  model: z.string().describe('Filter by model.').optional(),
  status: z.string().describe('Filter by task status.').optional(),
  agent_id: z.string().min(1).describe('Agent ID.').optional(),
  metadata: z.string().describe('Filter by metadata string.').optional(),
  created_after: z.string().describe('Only tasks created after this time are returned.').optional(),
  created_by_me: z.boolean().describe('Whether to return only tasks created by the current caller.').optional(),
}).describe('List batch jobs.')

export const listBatchJobsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listLibrariesInput = z.looseObject({
  limit: z.int().min(1).describe('Maximum number of libraries.').optional(),
  page_token: z.string().describe('Pagination token.').optional(),
}).describe('List libraries.')

export const listLibrariesOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createLibraryInput = z.looseObject({
  name: z.string().min(1).describe('Library name.'),
  description: z.string().describe('Library description.').optional(),
  chunk_size: z.int().describe('Document chunk size.').optional(),
}).describe('Create a library.')

export const createLibraryOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getLibraryInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
}).describe('Get one library.')

export const getLibraryOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const updateLibraryInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  name: z.string().describe('Updated library name.').optional(),
  description: z.string().describe('Updated library description.').optional(),
}).describe('Update a library.')

export const updateLibraryOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const deleteLibraryInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
}).describe('Delete one library.')

export const deleteLibraryOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listLibraryDocumentsInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  page: z.int().min(0).describe('Page number, starting from 0.').optional(),
  page_size: z.int().min(1).describe('The number of items returned per page.').optional(),
  search: z.string().describe('Document search keywords.').optional(),
  filters_attributes: z.string().describe('Property filter expression.').optional(),
  sort_by: z.string().describe('Sort field.').optional(),
  sort_order: z.enum(['asc', 'desc']).describe('Sort direction.').optional(),
}).describe('List library documents.')

export const listLibraryDocumentsOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const uploadLibraryDocumentInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  file: z.union([z.strictObject({
    fileId: z.string().min(1).describe('The transit file identifier returned by POST /api/files.'),
    name: z.string().min(1).describe('Optional filename override to send to the provider.').optional(),
    mimeType: z.string().min(1).describe('Optional MIME type override to send to the provider.').optional(),
  }).describe('A file previously uploaded to the local transit file API.'), z.strictObject({
    name: z.string().min(1).describe('The filename to send to Mistral.'),
    mimeType: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    mimetype: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    url: z.url().describe('A public HTTP or HTTPS URL that the connector can fetch and upload.'),
  }).describe('A public URL upload source.'), z.strictObject({
    name: z.string().min(1).describe('The filename to send to Mistral.'),
    mimeType: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    mimetype: z.string().min(1).describe('The MIME type of the uploaded file.').optional(),
    content_base64: z.string().min(1).describe('Base64-encoded file content.'),
  }).describe('A base64 upload source.')]).describe('File content to upload to Mistral.'),
}).describe('Upload a document to a library.')

export const uploadLibraryDocumentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getLibraryDocumentInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
}).describe('Get one library document.')

export const getLibraryDocumentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const updateLibraryDocumentInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
  name: z.string().describe('Updated document name.').optional(),
  attributes: z.record(z.string(), z.union([z.boolean().describe('Boolean attribute.'), z.string().describe('String attribute.'), z.number().describe('Numeric attribute.'), z.array(z.string().min(1)).min(1).describe('A list of strings.'), z.array(z.number().describe('A number.')).describe('A list of numbers.'), z.array(z.boolean().describe('A boolean.')).describe('A list of booleans.')]).describe('Attribute value.')).describe('Knowledge base document attributes.').optional(),
}).describe('Update a library document.')

export const updateLibraryDocumentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const deleteLibraryDocumentInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
}).describe('Delete one library document.')

export const deleteLibraryDocumentOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the resource has been deleted.'),
}).describe('Delete action response.')

export const getDocumentTextContentInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
}).describe('Get document text content.')

export const getDocumentTextContentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getDocumentStatusInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
}).describe('Get document processing status.')

export const getDocumentStatusOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getDocumentSignedUrlInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
}).describe('Get document signed URL.')

export const getDocumentSignedUrlOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const getDocumentExtractedTextUrlInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
}).describe('Get document extracted text URL.')

export const getDocumentExtractedTextUrlOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const reprocessDocumentInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  document_id: z.string().min(1).describe('Knowledge base document ID.'),
}).describe('Reprocess a library document.')

export const reprocessDocumentOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const listLibrarySharesInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
}).describe('List library shares.')

export const listLibrarySharesOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const createLibraryShareInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  level: z.enum(['Viewer', 'Editor']).describe('Sharing permission level.'),
  org_id: z.string().describe('Organization ID.').optional(),
  share_with_uuid: z.string().min(1).describe('The UUID of the shared object.'),
  share_with_type: z.string().min(1).describe('The entity type of the shared object.'),
}).describe('Create or update a library share.')

export const createLibraryShareOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

export const deleteLibraryShareInput = z.looseObject({
  library_id: z.string().min(1).describe('Knowledge base library ID.'),
  org_id: z.string().describe('Organization ID.').optional(),
  share_with_uuid: z.string().min(1).describe('The UUID of the object to unshare.'),
  share_with_type: z.string().min(1).describe('The object entity type to unshare.'),
}).describe('Remove a library share.')

export const deleteLibraryShareOutput = z.unknown().describe('Raw response data returned by the Mistral API.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const mistralAiActions = {
  list_models: {
    description: 'List all Mistral models accessible by the current API key.',
    effect: 'read',
    inputSchema: listModelsInput,
    outputSchema: z.toJSONSchema(listModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_model: {
    description: 'Get details of a single Mistral model by model ID.',
    effect: 'read',
    inputSchema: getModelInput,
    outputSchema: z.toJSONSchema(getModelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_conversations: {
    description: 'List conversations under the current organization with pagination and metadata filters.',
    effect: 'read',
    inputSchema: listConversationsInput,
    outputSchema: z.toJSONSchema(listConversationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  start_conversation: {
    description: 'Create a new conversation and append initial context.',
    effect: 'write',
    inputSchema: startConversationInput,
    outputSchema: z.toJSONSchema(startConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_conversation: {
    description: 'Get metadata for a single conversation by ID.',
    effect: 'read',
    inputSchema: getConversationInput,
    outputSchema: z.toJSONSchema(getConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_conversation: {
    description: 'Delete the specified conversation.',
    effect: 'destructive',
    inputSchema: deleteConversationInput,
    outputSchema: z.toJSONSchema(deleteConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  append_to_conversation: {
    description: 'Append a new message to an existing conversation.',
    effect: 'write',
    inputSchema: appendToConversationInput,
    outputSchema: z.toJSONSchema(appendToConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_conversation_history: {
    description: 'Get all history entries in a conversation.',
    effect: 'read',
    inputSchema: getConversationHistoryInput,
    outputSchema: z.toJSONSchema(getConversationHistoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_conversation_messages: {
    description: 'Get all message entries in a conversation.',
    effect: 'read',
    inputSchema: getConversationMessagesInput,
    outputSchema: z.toJSONSchema(getConversationMessagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  restart_conversation: {
    description: 'Restart a conversation from a historical entry.',
    effect: 'write',
    inputSchema: restartConversationInput,
    outputSchema: z.toJSONSchema(restartConversationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_agents: {
    description: 'List agents with pagination, name, source, or metadata filters.',
    effect: 'read',
    inputSchema: listAgentsInput,
    outputSchema: z.toJSONSchema(listAgentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_agent: {
    description: 'Create a new Mistral agent.',
    effect: 'write',
    inputSchema: createAgentInput,
    outputSchema: z.toJSONSchema(createAgentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_agent: {
    description: 'Get a single agent by ID.',
    effect: 'read',
    inputSchema: getAgentInput,
    outputSchema: z.toJSONSchema(getAgentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_agent: {
    description: 'Update an agent configuration and create a new version.',
    effect: 'write',
    inputSchema: updateAgentInput,
    outputSchema: z.toJSONSchema(updateAgentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_agent: {
    description: 'Delete the specified agent.',
    effect: 'destructive',
    inputSchema: deleteAgentInput,
    outputSchema: z.toJSONSchema(deleteAgentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_agent_version: {
    description: 'Switch the current version of an agent.',
    effect: 'write',
    inputSchema: updateAgentVersionInput,
    outputSchema: z.toJSONSchema(updateAgentVersionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_agent_versions: {
    description: 'List all versions of the specified agent.',
    effect: 'read',
    inputSchema: listAgentVersionsInput,
    outputSchema: z.toJSONSchema(listAgentVersionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_agent_version: {
    description: 'Get version details of the specified agent.',
    effect: 'read',
    inputSchema: getAgentVersionInput,
    outputSchema: z.toJSONSchema(getAgentVersionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_or_update_agent_alias: {
    description: 'Create or update an agent version alias.',
    effect: 'write',
    inputSchema: createOrUpdateAgentAliasInput,
    outputSchema: z.toJSONSchema(createOrUpdateAgentAliasOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_agent_aliases: {
    description: 'List all version aliases for the specified agent.',
    effect: 'read',
    inputSchema: listAgentAliasesInput,
    outputSchema: z.toJSONSchema(listAgentAliasesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_chat_completion: {
    description: 'Call the Mistral chat completions API.',
    effect: 'write',
    inputSchema: createChatCompletionInput,
    outputSchema: z.toJSONSchema(createChatCompletionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_fim_completion: {
    description: 'Call the Mistral FIM completions API.',
    effect: 'write',
    inputSchema: createFimCompletionInput,
    outputSchema: z.toJSONSchema(createFimCompletionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_agents_completion: {
    description: 'Call the Mistral agents completions API.',
    effect: 'write',
    inputSchema: createAgentsCompletionInput,
    outputSchema: z.toJSONSchema(createAgentsCompletionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_embeddings: {
    description: 'Generate embeddings with Mistral.',
    effect: 'write',
    inputSchema: createEmbeddingsInput,
    outputSchema: z.toJSONSchema(createEmbeddingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_moderation: {
    description: 'Detect text safety risks with Mistral moderation.',
    effect: 'write',
    inputSchema: createModerationInput,
    outputSchema: z.toJSONSchema(createModerationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_chat_moderation: {
    description: 'Detect chat message safety risks with Mistral moderation.',
    effect: 'write',
    inputSchema: createChatModerationInput,
    outputSchema: z.toJSONSchema(createChatModerationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_ocr: {
    description: 'Run Mistral OCR on a document or image.',
    effect: 'write',
    inputSchema: createOcrInput,
    outputSchema: z.toJSONSchema(createOcrOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_audio_transcription: {
    description: 'Upload or reference audio and create a transcription.',
    effect: 'write',
    inputSchema: createAudioTranscriptionInput,
    outputSchema: z.toJSONSchema(createAudioTranscriptionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_files: {
    description: 'List all files under the current organization.',
    effect: 'read',
    inputSchema: listFilesInput,
    outputSchema: z.toJSONSchema(listFilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upload_file: {
    description: 'Upload a file to Mistral for fine-tuning, batch, or OCR.',
    effect: 'write',
    inputSchema: uploadFileInput,
    outputSchema: z.toJSONSchema(uploadFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  retrieve_file: {
    description: 'Get file metadata by file ID.',
    effect: 'read',
    inputSchema: retrieveFileInput,
    outputSchema: z.toJSONSchema(retrieveFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_file: {
    description: 'Delete the specified file.',
    effect: 'destructive',
    inputSchema: deleteFileInput,
    outputSchema: z.toJSONSchema(deleteFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  download_file: {
    description: 'Download Mistral file contents into the local transit file store.',
    effect: 'read',
    inputSchema: downloadFileInput,
    outputSchema: z.toJSONSchema(downloadFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_file_signed_url: {
    description: 'Get a temporary signed download link for a file.',
    effect: 'read',
    inputSchema: getFileSignedUrlInput,
    outputSchema: z.toJSONSchema(getFileSignedUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_fine_tuning_jobs: {
    description: 'List fine-tuning jobs with pagination and filters.',
    effect: 'read',
    inputSchema: getFineTuningJobsInput,
    outputSchema: z.toJSONSchema(getFineTuningJobsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_batch_jobs: {
    description: 'List batch jobs with pagination and filters.',
    effect: 'read',
    inputSchema: listBatchJobsInput,
    outputSchema: z.toJSONSchema(listBatchJobsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_libraries: {
    description: 'List libraries under the current organization.',
    effect: 'read',
    inputSchema: listLibrariesInput,
    outputSchema: z.toJSONSchema(listLibrariesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_library: {
    description: 'Create a new Mistral library.',
    effect: 'write',
    inputSchema: createLibraryInput,
    outputSchema: z.toJSONSchema(createLibraryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_library: {
    description: 'Get library details by library ID.',
    effect: 'read',
    inputSchema: getLibraryInput,
    outputSchema: z.toJSONSchema(getLibraryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_library: {
    description: 'Update a library.',
    effect: 'write',
    inputSchema: updateLibraryInput,
    outputSchema: z.toJSONSchema(updateLibraryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_library: {
    description: 'Delete the specified library.',
    effect: 'destructive',
    inputSchema: deleteLibraryInput,
    outputSchema: z.toJSONSchema(deleteLibraryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_library_documents: {
    description: 'List documents under a library.',
    effect: 'read',
    inputSchema: listLibraryDocumentsInput,
    outputSchema: z.toJSONSchema(listLibraryDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upload_library_document: {
    description: 'Upload a new document to a library.',
    effect: 'write',
    inputSchema: uploadLibraryDocumentInput,
    outputSchema: z.toJSONSchema(uploadLibraryDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_library_document: {
    description: 'Get details of a single library document.',
    effect: 'read',
    inputSchema: getLibraryDocumentInput,
    outputSchema: z.toJSONSchema(getLibraryDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_library_document: {
    description: 'Update a library document.',
    effect: 'write',
    inputSchema: updateLibraryDocumentInput,
    outputSchema: z.toJSONSchema(updateLibraryDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_library_document: {
    description: 'Delete a library document.',
    effect: 'destructive',
    inputSchema: deleteLibraryDocumentInput,
    outputSchema: z.toJSONSchema(deleteLibraryDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_document_text_content: {
    description: 'Get extracted text content for a library document.',
    effect: 'read',
    inputSchema: getDocumentTextContentInput,
    outputSchema: z.toJSONSchema(getDocumentTextContentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_document_status: {
    description: 'Get processing status for a library document.',
    effect: 'read',
    inputSchema: getDocumentStatusInput,
    outputSchema: z.toJSONSchema(getDocumentStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_document_signed_url: {
    description: 'Get a temporary signed link to a library document\'s original file.',
    effect: 'read',
    inputSchema: getDocumentSignedUrlInput,
    outputSchema: z.toJSONSchema(getDocumentSignedUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_document_extracted_text_url: {
    description: 'Get a temporary signed link to a library document\'s extracted text file.',
    effect: 'read',
    inputSchema: getDocumentExtractedTextUrlInput,
    outputSchema: z.toJSONSchema(getDocumentExtractedTextUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  reprocess_document: {
    description: 'Reprocess the specified library document.',
    effect: 'write',
    inputSchema: reprocessDocumentInput,
    outputSchema: z.toJSONSchema(reprocessDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_library_shares: {
    description: 'List shared access records for a library.',
    effect: 'read',
    inputSchema: listLibrarySharesInput,
    outputSchema: z.toJSONSchema(listLibrarySharesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_library_share: {
    description: 'Create or update shared access for a library.',
    effect: 'write',
    inputSchema: createLibraryShareInput,
    outputSchema: z.toJSONSchema(createLibraryShareOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_library_share: {
    description: 'Remove shared access from a library.',
    effect: 'destructive',
    inputSchema: deleteLibraryShareInput,
    outputSchema: z.toJSONSchema(deleteLibraryShareOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
