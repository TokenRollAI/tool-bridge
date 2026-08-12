/**
 * OpenAI 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listModelsInput = z.looseObject({}).describe('No input parameters are required for this action.')

export const listModelsOutput = z.looseObject({
  object: z.string().describe('The top-level object type.'),
  data: z.array(z.looseObject({
    id: z.string().describe('The model identifier.'),
    object: z.string().describe('The object type returned by the API.'),
    created: z.int().describe('The Unix timestamp when the model was created.'),
    owned_by: z.string().describe('The organization or user that owns the model.'),
    root: z.string().describe('The root model identifier for a derived model.').optional(),
    parent: z.string().describe('The immediate parent model identifier, if any.').nullable().optional(),
    permission: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The permission entries returned for the model.').optional(),
  }).describe('An OpenAI model entry.')).describe('The list of available models.'),
}).describe('The response payload for listing OpenAI models.')

export const getModelInput = z.looseObject({
  model: z.string().describe('The exact model identifier to retrieve.'),
}).describe('The input payload for retrieving a single OpenAI model.')

export const getModelOutput = z.looseObject({
  id: z.string().describe('The model identifier.'),
  object: z.string().describe('The object type returned by the API.'),
  created: z.int().describe('The Unix timestamp when the model was created.'),
  owned_by: z.string().describe('The organization or user that owns the model.'),
  root: z.string().describe('The root model identifier for a derived model.').optional(),
  parent: z.string().describe('The immediate parent model identifier, if any.').nullable().optional(),
  permission: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The permission entries returned for the model.').optional(),
}).describe('An OpenAI model entry.')

export const createResponseInput = z.looseObject({
  model: z.string().describe('The model to use for the response.'),
  input: z.union([z.string().describe('A plain text prompt.'), z.array(z.strictObject({
    role: z.enum(['system', 'user', 'assistant', 'developer']).describe('The role of the message author.'),
    content: z.union([z.string().describe('Plain text content for a simple message.'), z.array(z.union([z.strictObject({
      type: z.literal('input_text').describe('The content type. Must be input_text.'),
      text: z.string().describe('The text content sent to the model.'),
    }).describe('A text content block for a response input message.'), z.strictObject({
      type: z.literal('input_image').describe('The content type. Must be input_image.'),
      image_url: z.string().describe('A remote image URL or a data URL containing the image bytes.'),
      detail: z.enum(['auto', 'low', 'high', 'original']).describe('The requested image detail level.').optional(),
    }).describe('An image content block for a response input message.'), z.strictObject({
      type: z.literal('input_file').describe('The content type. Must be input_file.'),
      file_id: z.string().describe('The uploaded file ID to reference.').optional(),
      file_data: z.string().describe('The inline file data encoded as base64 or supplied as a data URL.').optional(),
      filename: z.string().describe('The filename to report for inline file data.').optional(),
    }).describe('A file content block for a response input message.')])).min(1).describe('Structured multimodal content blocks.')]),
  }).describe('A message in the Responses API input array.')).min(1).describe('An ordered array of conversation messages.')]),
  instructions: z.string().describe('A top-level instruction string applied before the input.').optional(),
  max_output_tokens: z.int().min(1).describe('The maximum number of output tokens to generate.').optional(),
  metadata: z.record(z.string(), z.string().describe('Metadata field value.')).describe('String metadata fields attached to the request.').optional(),
  previous_response_id: z.string().describe('The ID of a previous response to continue from.').optional(),
  store: z.boolean().describe('Whether the response may be stored by the upstream platform.').optional(),
  temperature: z.number().min(0).max(2).describe('The sampling temperature.').optional(),
  text: z.strictObject({
    format: z.union([z.strictObject({
      type: z.literal('json_object').describe('The format type. Must be json_object.'),
    }).describe('A flexible JSON object output format.'), z.strictObject({
      type: z.literal('json_schema').describe('The format type. Must be json_schema.'),
      name: z.string().describe('The schema name reported to the model.'),
      schema: z.looseObject({}).describe('Any JSON object.'),
      strict: z.boolean().describe('Whether the model must strictly follow the declared schema.').optional(),
    }).describe('A JSON Schema output format.')]).optional(),
  }).describe('Text output configuration for the response.').optional(),
  top_p: z.number().min(0).max(1).describe('The nucleus sampling threshold.').optional(),
  user: z.string().describe('An end-user identifier passed through to the upstream API.').optional(),
  stream: z.boolean().describe('Whether to request a streaming response. This connector only accepts false or an omitted value.').optional(),
}).describe('The input payload for creating a non-streaming OpenAI response.')

export const createResponseOutput = z.looseObject({
  id: z.string().describe('The response identifier.'),
  object: z.string().describe('The top-level object type.').optional(),
  created_at: z.int().describe('The Unix timestamp when the response was created.').optional(),
  status: z.string().describe('The response status.').optional(),
  model: z.string().describe('The model that generated the response.').optional(),
  output: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The raw output items returned by the response.'),
  output_text: z.string().describe('The aggregated plain text extracted from the output items.').optional(),
  usage: z.looseObject({}).describe('Any JSON object.').optional(),
  error: z.looseObject({}).describe('Any JSON object.').nullable().optional(),
  incomplete_details: z.looseObject({}).describe('Any JSON object.').nullable().optional(),
  previous_response_id: z.string().describe('The previous response ID referenced by this response.').nullable().optional(),
  store: z.boolean().describe('Whether the response is stored by the upstream platform.').optional(),
  expire_at: z.int().describe('The Unix timestamp when the stored response expires.').optional(),
}).describe('The response payload returned by the OpenAI Responses API.')

export const getResponseInput = z.looseObject({
  response_id: z.string().describe('The response identifier.'),
  include: z.array(z.string().describe('One response field path to include.')).min(1).describe('Additional response fields to include in the result.').optional(),
}).describe('The input payload for retrieving one stored OpenAI response.')

export const getResponseOutput = z.looseObject({
  id: z.string().describe('The response identifier.'),
  object: z.string().describe('The top-level object type.').optional(),
  created_at: z.int().describe('The Unix timestamp when the response was created.').optional(),
  status: z.string().describe('The response status.').optional(),
  model: z.string().describe('The model that generated the response.').optional(),
  output: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The raw output items returned by the response.'),
  output_text: z.string().describe('The aggregated plain text extracted from the output items.').optional(),
  usage: z.looseObject({}).describe('Any JSON object.').optional(),
  error: z.looseObject({}).describe('Any JSON object.').nullable().optional(),
  incomplete_details: z.looseObject({}).describe('Any JSON object.').nullable().optional(),
  previous_response_id: z.string().describe('The previous response ID referenced by this response.').nullable().optional(),
  store: z.boolean().describe('Whether the response is stored by the upstream platform.').optional(),
  expire_at: z.int().describe('The Unix timestamp when the stored response expires.').optional(),
}).describe('The response payload returned by the OpenAI Responses API.')

export const listInputItemsInput = z.looseObject({
  response_id: z.string().describe('The response identifier whose input items should be listed.'),
  after: z.string().describe('Return items after this item identifier.').optional(),
  include: z.array(z.string().describe('One input item field path to include.')).min(1).describe('Additional input item fields to include in the result.').optional(),
  limit: z.int().min(1).describe('The maximum number of input items to return.').optional(),
  order: z.enum(['asc', 'desc']).describe('The sort order for returned items.').optional(),
}).describe('The input payload for listing stored response input items.')

export const listInputItemsOutput = z.looseObject({
  object: z.string().describe('The object type returned by the API.').optional(),
  data: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The returned input items.'),
  first_id: z.string().describe('The first item identifier in the page.').optional(),
  last_id: z.string().describe('The last item identifier in the page.').optional(),
  has_more: z.boolean().describe('Whether more input items are available.').optional(),
}).describe('The response payload for listing stored response input items.')

export const getInputTokenCountsInput = z.looseObject({
  model: z.string().describe('The model used for counting the input tokens.').optional(),
  input: z.union([z.string().describe('A plain text prompt.'), z.array(z.strictObject({
    role: z.enum(['system', 'user', 'assistant', 'developer']).describe('The role of the message author.'),
    content: z.union([z.string().describe('Plain text content for a simple message.'), z.array(z.union([z.strictObject({
      type: z.literal('input_text').describe('The content type. Must be input_text.'),
      text: z.string().describe('The text content sent to the model.'),
    }).describe('A text content block for a response input message.'), z.strictObject({
      type: z.literal('input_image').describe('The content type. Must be input_image.'),
      image_url: z.string().describe('A remote image URL or a data URL containing the image bytes.'),
      detail: z.enum(['auto', 'low', 'high', 'original']).describe('The requested image detail level.').optional(),
    }).describe('An image content block for a response input message.'), z.strictObject({
      type: z.literal('input_file').describe('The content type. Must be input_file.'),
      file_id: z.string().describe('The uploaded file ID to reference.').optional(),
      file_data: z.string().describe('The inline file data encoded as base64 or supplied as a data URL.').optional(),
      filename: z.string().describe('The filename to report for inline file data.').optional(),
    }).describe('A file content block for a response input message.')])).min(1).describe('Structured multimodal content blocks.')]),
  }).describe('A message in the Responses API input array.')).min(1).describe('An ordered array of conversation messages.')]).optional(),
  instructions: z.string().describe('Top-level instructions to include in the token count.').optional(),
  previous_response_id: z.string().describe('A previous response identifier to continue counting from.').optional(),
  text: z.strictObject({
    format: z.union([z.strictObject({
      type: z.literal('json_object').describe('The format type. Must be json_object.'),
    }).describe('A flexible JSON object output format.'), z.strictObject({
      type: z.literal('json_schema').describe('The format type. Must be json_schema.'),
      name: z.string().describe('The schema name reported to the model.'),
      schema: z.looseObject({}).describe('Any JSON object.'),
      strict: z.boolean().describe('Whether the model must strictly follow the declared schema.').optional(),
    }).describe('A JSON Schema output format.')]).optional(),
  }).describe('Text output configuration for the response.').optional(),
  truncation: z.string().describe('The truncation mode to apply before counting.').optional(),
}).describe('The input payload for counting input tokens for a Responses-style request.')

export const getInputTokenCountsOutput = z.looseObject({
  object: z.string().describe('The object type returned by the API.').optional(),
  input_tokens: z.int().describe('The number of input tokens the request would consume.'),
}).describe('The token count payload returned by the Responses input token count API.')

export const createEmbeddingsInput = z.looseObject({
  input: z.union([z.string().describe('A single input string to embed.'), z.array(z.string().describe('One input string.')).min(1).describe('A batch of input strings.'), z.array(z.int().describe('A single token ID.')).min(1).describe('A tokenized input sequence.'), z.array(z.array(z.int().describe('A single token ID.')).min(1)).min(1).describe('A batch of tokenized input sequences.')]),
  model: z.string().describe('The embedding model to use.'),
  dimensions: z.int().min(1).describe('The number of embedding dimensions to request.').optional(),
  encoding_format: z.enum(['float', 'base64']).describe('The embedding encoding format to return.').optional(),
  user: z.string().describe('An end-user identifier passed through to the upstream API.').optional(),
}).describe('The input payload for creating OpenAI embeddings.')

export const createEmbeddingsOutput = z.looseObject({
  object: z.string().describe('The top-level object type.'),
  data: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The embedding items returned by the API.'),
  model: z.string().describe('The model that generated the embeddings.'),
  usage: z.looseObject({}).describe('Any JSON object.'),
}).describe('The response payload for creating OpenAI embeddings.')

export const createModerationInput = z.looseObject({
  input: z.union([z.string().describe('A single text input.'), z.array(z.union([z.string().describe('One text input.'), z.strictObject({
    type: z.enum(['text', 'image_url']).describe('The moderation input type.'),
    text: z.string().describe('The text content when the input type is text.').optional(),
    image_url: z.union([z.string().describe('A direct image URL.'), z.looseObject({}).describe('Any JSON object.')]).optional(),
  }).describe('A multimodal moderation input item.')])).min(1).describe('A batch of moderation inputs.')]),
  model: z.string().describe('The moderation model to use.').optional(),
}).describe('The input payload for creating an OpenAI moderation request.')

export const createModerationOutput = z.looseObject({
  id: z.string().describe('The moderation request identifier.'),
  model: z.string().describe('The moderation model used for the request.'),
  results: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The moderation results for each input.'),
}).describe('The response payload for creating an OpenAI moderation request.')

export const createImageInput = z.looseObject({
  prompt: z.string().describe('The prompt used to generate the image.'),
  model: z.string().describe('The image generation model to use.').optional(),
  background: z.enum(['auto', 'opaque', 'transparent']).describe('The background treatment to request for generated images.').optional(),
  moderation: z.string().describe('The moderation level applied to the generation.').optional(),
  n: z.int().min(1).describe('The number of images to generate.').optional(),
  output_compression: z.int().min(0).max(100).describe('The output compression level to apply.').optional(),
  output_format: z.enum(['png', 'jpeg', 'webp']).describe('The image output format to request.').optional(),
  partial_images: z.int().min(0).describe('The number of partial images to stream before completion.').optional(),
  quality: z.string().describe('The image quality to request.').optional(),
  response_format: z.enum(['b64_json', 'url']).describe('The image payload format to return.').optional(),
  size: z.string().describe('The requested image size.').optional(),
  stream: z.boolean().describe('Whether to request a streaming image generation response. This connector only accepts false or an omitted value.').optional(),
  user: z.string().describe('An end-user identifier passed through to the upstream API.').optional(),
}).describe('The input payload for creating one or more OpenAI images.')

export const createImageOutput = z.looseObject({
  created: z.int().describe('The Unix timestamp when the image response was created.').optional(),
  data: z.array(z.looseObject({
    b64_json: z.string().describe('The generated image encoded as base64.').optional(),
    url: z.string().describe('The signed image URL returned by the API.').optional(),
    revised_prompt: z.string().describe('The prompt potentially revised by the model before generation.').optional(),
  }).describe('One generated image item returned by the API.')).describe('The generated image items returned by the API.'),
  usage: z.looseObject({}).describe('Any JSON object.').optional(),
}).describe('The response payload for creating OpenAI images.')

export const createSpeechInput = z.looseObject({
  model: z.string().describe('The text-to-speech model to use.'),
  input: z.string().describe('The text to synthesize into speech.'),
  voice: z.union([z.string().describe('A built-in voice name.'), z.looseObject({}).describe('Any JSON object.')]),
  instructions: z.string().describe('Optional voice instructions that guide the synthesis style.').optional(),
  response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).describe('The audio format to return.').optional(),
  speed: z.number().min(0.25).max(4).describe('The playback speed multiplier.').optional(),
  stream_format: z.enum(['audio', 'sse']).describe('The speech response delivery format. This connector only accepts audio or an omitted value.').optional(),
}).describe('The input payload for creating OpenAI speech audio.')

export const createSpeechOutput = z.looseObject({
  content_base64: z.string().describe('The synthesized audio encoded as base64.'),
  content_type: z.string().describe('The MIME type of the synthesized audio.'),
}).describe('The normalized speech audio payload returned by the connector.')

export const createAudioTranscriptionInput = z.looseObject({
  file: z.strictObject({
    name: z.string().min(1).describe('The filename to report when uploading the audio file.'),
    mimetype: z.string().describe('The MIME type of the audio file.').optional(),
    url: z.string().describe('A public URL pointing to the audio file.').optional(),
    content_base64: z.string().min(1).describe('The base64-encoded audio content to upload.').optional(),
  }).describe('The audio file source to upload.'),
  model: z.string().describe('The transcription model to use.'),
  chunking_strategy: z.looseObject({}).describe('Any JSON object.').optional(),
  include: z.array(z.string().describe('One additional response field to include.')).min(1).describe('Additional response fields to include.').optional(),
  language: z.string().describe('The language code of the source audio.').optional(),
  prompt: z.string().describe('A guiding prompt for the transcription.').optional(),
  response_format: z.string().describe('The response format to return.').optional(),
  stream: z.boolean().describe('Whether to request a streaming transcription response. This connector only accepts false or an omitted value.').optional(),
  temperature: z.number().min(0).max(1).describe('The sampling temperature.').optional(),
  timestamp_granularities: z.array(z.enum(['word', 'segment'])).min(1).describe('The timestamp granularities to include.').optional(),
}).describe('The input payload for creating an OpenAI audio transcription.')

export const createAudioTranscriptionOutput = z.looseObject({
  text: z.string().describe('The transcribed or translated text.').optional(),
  language: z.string().describe('The detected or returned language code.').optional(),
  duration: z.number().describe('The duration of the processed audio in seconds.').optional(),
  segments: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The segment-level timing details.').optional(),
  words: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The word-level timing details.').optional(),
  logprobs: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The token log probabilities, if requested.').optional(),
  usage: z.looseObject({}).describe('Any JSON object.').optional(),
}).describe('The normalized payload returned by an OpenAI audio text endpoint.')

export const createAudioTranslationInput = z.looseObject({
  file: z.strictObject({
    name: z.string().min(1).describe('The filename to report when uploading the audio file.'),
    mimetype: z.string().describe('The MIME type of the audio file.').optional(),
    url: z.string().describe('A public URL pointing to the audio file.').optional(),
    content_base64: z.string().min(1).describe('The base64-encoded audio content to upload.').optional(),
  }).describe('The audio file source to upload.'),
  model: z.string().describe('The translation model to use.'),
  prompt: z.string().describe('A guiding prompt for the translation.').optional(),
  response_format: z.string().describe('The response format to return.').optional(),
  temperature: z.number().min(0).max(1).describe('The sampling temperature.').optional(),
}).describe('The input payload for creating an OpenAI audio translation.')

export const createAudioTranslationOutput = z.looseObject({
  text: z.string().describe('The transcribed or translated text.').optional(),
  language: z.string().describe('The detected or returned language code.').optional(),
  duration: z.number().describe('The duration of the processed audio in seconds.').optional(),
  segments: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The segment-level timing details.').optional(),
  words: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The word-level timing details.').optional(),
  logprobs: z.array(z.looseObject({}).describe('Any JSON object.')).describe('The token log probabilities, if requested.').optional(),
  usage: z.looseObject({}).describe('Any JSON object.').optional(),
}).describe('The normalized payload returned by an OpenAI audio text endpoint.')

export const createBatchInput = z.looseObject({
  input_file_id: z.string().describe('The uploaded input file identifier to process.'),
  endpoint: z.string().describe('The API endpoint executed for each batch item.'),
  completion_window: z.string().describe('The requested completion window, such as `24h`.'),
  metadata: z.record(z.string(), z.string().describe('Metadata field value.')).describe('String metadata fields attached to the request.').optional(),
}).describe('The input payload for creating an OpenAI batch.')

export const createBatchOutput = z.looseObject({
  id: z.string().describe('The batch identifier.'),
  object: z.string().describe('The object type returned by the API.').optional(),
  endpoint: z.string().describe('The endpoint executed for each batch request.').optional(),
  input_file_id: z.string().describe('The input file identifier used by the batch.').optional(),
  output_file_id: z.string().describe('The output file identifier created by the batch.').optional(),
  error_file_id: z.string().describe('The error file identifier created by the batch.').optional(),
  completion_window: z.string().describe('The completion window requested for the batch.').optional(),
  status: z.string().describe('The current status of the batch.').optional(),
  metadata: z.record(z.string(), z.string().describe('Metadata field value.')).describe('String metadata fields attached to the request.').optional(),
  request_counts: z.looseObject({}).describe('Any JSON object.').optional(),
  errors: z.unknown().describe('The batch errors returned by the API.').optional(),
  created_at: z.int().describe('The Unix timestamp when the batch was created.').optional(),
  in_progress_at: z.int().describe('The Unix timestamp when the batch started processing.').optional(),
  finalizing_at: z.int().describe('The Unix timestamp when the batch started finalizing.').optional(),
  completed_at: z.int().describe('The Unix timestamp when the batch completed.').optional(),
  cancelling_at: z.int().describe('The Unix timestamp when the batch started cancelling.').optional(),
  cancelled_at: z.int().describe('The Unix timestamp when the batch was cancelled.').optional(),
  failed_at: z.int().describe('The Unix timestamp when the batch failed.').optional(),
  expired_at: z.int().describe('The Unix timestamp when the batch expired.').optional(),
  expires_at: z.int().describe('The Unix timestamp when the batch will expire.').optional(),
}).describe('An OpenAI batch object.')

export const getBatchInput = z.looseObject({
  batch_id: z.string().describe('The batch identifier.'),
}).describe('The input payload for a batch lookup action.')

export const getBatchOutput = z.looseObject({
  id: z.string().describe('The batch identifier.'),
  object: z.string().describe('The object type returned by the API.').optional(),
  endpoint: z.string().describe('The endpoint executed for each batch request.').optional(),
  input_file_id: z.string().describe('The input file identifier used by the batch.').optional(),
  output_file_id: z.string().describe('The output file identifier created by the batch.').optional(),
  error_file_id: z.string().describe('The error file identifier created by the batch.').optional(),
  completion_window: z.string().describe('The completion window requested for the batch.').optional(),
  status: z.string().describe('The current status of the batch.').optional(),
  metadata: z.record(z.string(), z.string().describe('Metadata field value.')).describe('String metadata fields attached to the request.').optional(),
  request_counts: z.looseObject({}).describe('Any JSON object.').optional(),
  errors: z.unknown().describe('The batch errors returned by the API.').optional(),
  created_at: z.int().describe('The Unix timestamp when the batch was created.').optional(),
  in_progress_at: z.int().describe('The Unix timestamp when the batch started processing.').optional(),
  finalizing_at: z.int().describe('The Unix timestamp when the batch started finalizing.').optional(),
  completed_at: z.int().describe('The Unix timestamp when the batch completed.').optional(),
  cancelling_at: z.int().describe('The Unix timestamp when the batch started cancelling.').optional(),
  cancelled_at: z.int().describe('The Unix timestamp when the batch was cancelled.').optional(),
  failed_at: z.int().describe('The Unix timestamp when the batch failed.').optional(),
  expired_at: z.int().describe('The Unix timestamp when the batch expired.').optional(),
  expires_at: z.int().describe('The Unix timestamp when the batch will expire.').optional(),
}).describe('An OpenAI batch object.')

export const cancelBatchInput = z.looseObject({
  batch_id: z.string().describe('The batch identifier.'),
}).describe('The input payload for a batch lookup action.')

export const cancelBatchOutput = z.looseObject({
  id: z.string().describe('The batch identifier.'),
  object: z.string().describe('The object type returned by the API.').optional(),
  endpoint: z.string().describe('The endpoint executed for each batch request.').optional(),
  input_file_id: z.string().describe('The input file identifier used by the batch.').optional(),
  output_file_id: z.string().describe('The output file identifier created by the batch.').optional(),
  error_file_id: z.string().describe('The error file identifier created by the batch.').optional(),
  completion_window: z.string().describe('The completion window requested for the batch.').optional(),
  status: z.string().describe('The current status of the batch.').optional(),
  metadata: z.record(z.string(), z.string().describe('Metadata field value.')).describe('String metadata fields attached to the request.').optional(),
  request_counts: z.looseObject({}).describe('Any JSON object.').optional(),
  errors: z.unknown().describe('The batch errors returned by the API.').optional(),
  created_at: z.int().describe('The Unix timestamp when the batch was created.').optional(),
  in_progress_at: z.int().describe('The Unix timestamp when the batch started processing.').optional(),
  finalizing_at: z.int().describe('The Unix timestamp when the batch started finalizing.').optional(),
  completed_at: z.int().describe('The Unix timestamp when the batch completed.').optional(),
  cancelling_at: z.int().describe('The Unix timestamp when the batch started cancelling.').optional(),
  cancelled_at: z.int().describe('The Unix timestamp when the batch was cancelled.').optional(),
  failed_at: z.int().describe('The Unix timestamp when the batch failed.').optional(),
  expired_at: z.int().describe('The Unix timestamp when the batch expired.').optional(),
  expires_at: z.int().describe('The Unix timestamp when the batch will expire.').optional(),
}).describe('An OpenAI batch object.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const openaiActions = {
  list_models: {
    description: 'List the OpenAI models available to the current API key.',
    effect: 'read',
    inputSchema: listModelsInput,
    outputSchema: z.toJSONSchema(listModelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_model: {
    description: 'Retrieve the metadata for a single OpenAI model by ID.',
    effect: 'read',
    inputSchema: getModelInput,
    outputSchema: z.toJSONSchema(getModelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_response: {
    description: 'Create a non-streaming OpenAI response through the Responses API.',
    effect: 'write',
    inputSchema: createResponseInput,
    outputSchema: z.toJSONSchema(createResponseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_response: {
    description: 'Retrieve one stored OpenAI response by its identifier.',
    effect: 'read',
    inputSchema: getResponseInput,
    outputSchema: z.toJSONSchema(getResponseOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_input_items: {
    description: 'List the stored input items for one OpenAI response.',
    effect: 'read',
    inputSchema: listInputItemsInput,
    outputSchema: z.toJSONSchema(listInputItemsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_input_token_counts: {
    description: 'Count how many input tokens a Responses-style OpenAI request would consume.',
    effect: 'read',
    inputSchema: getInputTokenCountsInput,
    outputSchema: z.toJSONSchema(getInputTokenCountsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_embeddings: {
    description: 'Create embeddings with an OpenAI embedding model.',
    effect: 'write',
    inputSchema: createEmbeddingsInput,
    outputSchema: z.toJSONSchema(createEmbeddingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_moderation: {
    description: 'Classify text or image inputs with the OpenAI Moderations API.',
    effect: 'write',
    inputSchema: createModerationInput,
    outputSchema: z.toJSONSchema(createModerationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_image: {
    description: 'Generate images with the OpenAI image generation API.',
    effect: 'write',
    inputSchema: createImageInput,
    outputSchema: z.toJSONSchema(createImageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_speech: {
    description: 'Synthesize speech audio from text with the OpenAI audio speech API.',
    effect: 'write',
    inputSchema: createSpeechInput,
    outputSchema: z.toJSONSchema(createSpeechOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_audio_transcription: {
    description: 'Transcribe one uploaded audio file with the OpenAI audio transcription API.',
    effect: 'write',
    inputSchema: createAudioTranscriptionInput,
    outputSchema: z.toJSONSchema(createAudioTranscriptionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_audio_translation: {
    description: 'Translate one uploaded audio file into English with the OpenAI audio translation API.',
    effect: 'write',
    inputSchema: createAudioTranslationInput,
    outputSchema: z.toJSONSchema(createAudioTranslationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_batch: {
    description: 'Create an OpenAI batch job from an uploaded input file.',
    effect: 'write',
    inputSchema: createBatchInput,
    outputSchema: z.toJSONSchema(createBatchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_batch: {
    description: 'Fetch one OpenAI batch job by its identifier.',
    effect: 'read',
    inputSchema: getBatchInput,
    outputSchema: z.toJSONSchema(getBatchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  cancel_batch: {
    description: 'Cancel one in-progress OpenAI batch job by its identifier.',
    effect: 'destructive',
    inputSchema: cancelBatchInput,
    outputSchema: z.toJSONSchema(cancelBatchOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
