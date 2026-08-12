/**
 * Templated 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAccountInput = z.strictObject({}).describe('Action input.')

export const getAccountOutput = z.strictObject({
  account: z.looseObject({
    id: z.string().describe('Unique identifier of the Templated account.').optional(),
    name: z.string().describe('Display name of the Templated account.').optional(),
    email: z.string().describe('Email address associated with the Templated account.').optional(),
    plan: z.string().describe('Current Templated plan name when available.').nullable().optional(),
    watermark: z.boolean().describe('Whether generated renders include the Templated watermark.').optional(),
    createdAt: z.string().describe('Timestamp when the account was created.').nullable().optional(),
  }).describe('Templated account returned by the API.'),
}).describe('Current Templated account.')

export const listTemplatesInput = z.strictObject({
  query: z.string().min(1).describe('Optional template name filter.').optional(),
  page: z.int().min(0).describe('Zero-based page number for pagination.').optional(),
  limit: z.int().min(1).describe('Maximum number of templates to return.').optional(),
  width: z.int().min(1).describe('Filter templates by width in pixels.').optional(),
  height: z.int().min(1).describe('Filter templates by height in pixels.').optional(),
  tags: z.array(z.string().min(1)).min(1).describe('Filter templates by tags.').optional(),
  externalId: z.string().min(1).describe('Filter templates by external identifier.').optional(),
  includeLayers: z.boolean().describe('Whether to include template layers in the response.').optional(),
  includePages: z.boolean().describe('Whether to include template pages in the response.').optional(),
}).describe('Action input.')

export const listTemplatesOutput = z.strictObject({
  templates: z.array(z.looseObject({
    id: z.string().describe('Unique identifier of the template.').optional(),
    name: z.string().describe('Template name.').optional(),
    description: z.string().describe('Template description.').nullable().optional(),
    width: z.int().describe('Template width in pixels.').nullable().optional(),
    height: z.int().describe('Template height in pixels.').nullable().optional(),
    thumbnail: z.string().describe('Template thumbnail URL.').nullable().optional(),
    background: z.string().describe('Template background color.').nullable().optional(),
    layersCount: z.int().describe('Number of editable layers in the template.').nullable().optional(),
    folderId: z.string().describe('Folder identifier that contains the template.').nullable().optional(),
    externalId: z.string().describe('External identifier associated with the template.').nullable().optional(),
    user: z.looseObject({
      id: z.string().describe('Unique identifier of the Templated user.').optional(),
      name: z.string().describe('Display name of the Templated user.').optional(),
    }).describe('User summary returned by Templated.').nullable().optional(),
    layers: z.array(z.unknown().describe('A template layer.')).describe('Template layers returned when includeLayers is enabled.').optional(),
    pages: z.array(z.unknown().describe('A template page.')).describe('Template pages returned when includePages is enabled.').optional(),
    tags: z.array(z.string().min(1)).describe('Template tags returned by Templated when available.').optional(),
  }).describe('Templated template.')).describe('Templates returned by Templated.'),
}).describe('Templated template list.')

export const getTemplateInput = z.strictObject({
  templateId: z.string().min(1).describe('The template ID.'),
  includeLayers: z.boolean().describe('Whether to include template layers in the response.').optional(),
  includePages: z.boolean().describe('Whether to include template pages in the response.').optional(),
}).describe('Action input.')

export const getTemplateOutput = z.strictObject({
  template: z.looseObject({
    id: z.string().describe('Unique identifier of the template.').optional(),
    name: z.string().describe('Template name.').optional(),
    description: z.string().describe('Template description.').nullable().optional(),
    width: z.int().describe('Template width in pixels.').nullable().optional(),
    height: z.int().describe('Template height in pixels.').nullable().optional(),
    thumbnail: z.string().describe('Template thumbnail URL.').nullable().optional(),
    background: z.string().describe('Template background color.').nullable().optional(),
    layersCount: z.int().describe('Number of editable layers in the template.').nullable().optional(),
    folderId: z.string().describe('Folder identifier that contains the template.').nullable().optional(),
    externalId: z.string().describe('External identifier associated with the template.').nullable().optional(),
    user: z.looseObject({
      id: z.string().describe('Unique identifier of the Templated user.').optional(),
      name: z.string().describe('Display name of the Templated user.').optional(),
    }).describe('User summary returned by Templated.').nullable().optional(),
    layers: z.array(z.unknown().describe('A template layer.')).describe('Template layers returned when includeLayers is enabled.').optional(),
    pages: z.array(z.unknown().describe('A template page.')).describe('Template pages returned when includePages is enabled.').optional(),
    tags: z.array(z.string().min(1)).describe('Template tags returned by Templated when available.').optional(),
  }).describe('Templated template.'),
}).describe('Single Templated template.')

export const createRenderInput = z.strictObject({
  templateId: z.string().min(1).describe('Template ID to render.'),
  format: z.enum(['jpg', 'png', 'webp', 'pdf']).describe('Output format for the render.').optional(),
  transparent: z.boolean().describe('Whether the background should be transparent for PNG renders.').optional(),
  flatten: z.boolean().describe('Whether PDF output should be flattened.').optional(),
  cmyk: z.boolean().describe('Whether PDF output should use CMYK color mode.').optional(),
  name: z.string().min(1).describe('Optional custom name for the render.').optional(),
  background: z.string().min(1).describe('Optional background color override.').optional(),
  width: z.int().min(100).max(5000).describe('Optional custom render width in pixels.').optional(),
  height: z.int().min(100).max(5000).describe('Optional custom render height in pixels.').optional(),
  scale: z.number().min(0.1).max(2).describe('Optional render scale factor.').optional(),
  externalId: z.string().min(1).describe('Optional external identifier for the render.').optional(),
  async: z.boolean().describe('Whether the render should be created asynchronously.').optional(),
  webhookUrl: z.url().describe('Optional webhook URL that receives the final Render object.').optional(),
  layers: z.record(z.string(), z.looseObject({
    text: z.string().describe('Replacement text for the layer.').optional(),
    image_url: z.url().describe('Replacement image URL for an image layer.').optional(),
    color: z.string().describe('Primary color override such as #FF0000.').optional(),
    color_2: z.string().describe('Secondary text color override.').optional(),
    background: z.string().describe('Background color override.').optional(),
    font_family: z.string().describe('Primary font family override.').optional(),
    font_family_2: z.string().describe('Secondary font family override.').optional(),
    font_size: z.string().describe('Font size override such as 24px or 12pt.').optional(),
    font_weight: z.string().describe('Font weight override.').optional(),
    letter_spacing: z.string().describe('Letter spacing override.').optional(),
    line_height: z.string().describe('Line height override.').optional(),
    text_stroke_width: z.number().describe('Text stroke width in pixels.').optional(),
    text_stroke_color: z.string().describe('Text stroke color override.').optional(),
    text_highlight_color: z.string().describe('Text highlight color override.').optional(),
    padding_x: z.int().min(1).describe('Horizontal padding in pixels.').optional(),
    padding_y: z.int().min(1).describe('Vertical padding in pixels.').optional(),
    horizontal_align: z.string().describe('Horizontal text alignment override.').optional(),
    vertical_align: z.string().describe('Vertical text alignment override.').optional(),
    autofit: z.string().describe('Auto-fit mode such as width or height.').optional(),
    border_width: z.int().min(0).describe('Border width in pixels.').optional(),
    border_color: z.string().describe('Border color override.').optional(),
    border_radius: z.string().describe('Border radius override.').optional(),
    border_style: z.string().describe('Border style override.').optional(),
    dash_length: z.number().describe('Custom dash length for dashed borders.').optional(),
    dash_gap: z.number().describe('Custom gap length for dashed borders.').optional(),
    fill: z.string().describe('Fill color or gradient override.').optional(),
    stroke: z.string().describe('Stroke color override.').optional(),
    preserve_ratio: z.boolean().describe('Whether vector content keeps its aspect ratio.').optional(),
    hide: z.boolean().describe('Whether the layer should be hidden.').optional(),
    opacity: z.number().min(0).max(1).describe('Layer opacity between 0 and 1.').optional(),
    link: z.url().describe('Clickable URL applied to PDF renders.').optional(),
    x: z.int().describe('Layer X position in pixels.').optional(),
    y: z.int().describe('Layer Y position in pixels.').optional(),
    rotation: z.int().describe('Layer rotation in degrees.').optional(),
    width: z.int().min(1).describe('Layer width in pixels.').optional(),
    height: z.int().min(1).describe('Layer height in pixels.').optional(),
    flip_x: z.boolean().describe('Whether the layer is flipped horizontally.').optional(),
    flip_y: z.boolean().describe('Whether the layer is flipped vertically.').optional(),
    object_fit: z.string().describe('Image object-fit override.').optional(),
    object_position: z.string().describe('Image object-position override.').optional(),
    crop_x: z.number().min(0).max(100).describe('Crop X percentage.').optional(),
    crop_y: z.number().min(0).max(100).describe('Crop Y percentage.').optional(),
    crop_width: z.number().min(0).max(100).describe('Crop width percentage.').optional(),
    crop_height: z.number().min(0).max(100).describe('Crop height percentage.').optional(),
    filter: z.string().describe('CSS filter override for image layers.').optional(),
    barcode_format: z.string().describe('Barcode format override.').optional(),
    rating: z.number().describe('Rating value for a star-rating layer.').optional(),
    html: z.string().describe('Custom HTML content override.').optional(),
  }).describe('Layer override object forwarded to Templated.')).describe('Map of template layer names to layer override objects.').optional(),
}).describe('Action input.')

export const createRenderOutput = z.strictObject({
  renders: z.array(z.looseObject({
    id: z.string().describe('Unique identifier of the render.').optional(),
    url: z.string().describe('URL of the rendered asset.').nullable().optional(),
    width: z.int().describe('Rendered width in pixels.').nullable().optional(),
    height: z.int().describe('Rendered height in pixels.').nullable().optional(),
    name: z.string().describe('Render name.').nullable().optional(),
    status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).describe('Current render status reported by Templated.').optional(),
    format: z.string().describe('Output format of the render.').nullable().optional(),
    templateId: z.string().describe('Template identifier used to generate the render.').nullable().optional(),
    templateName: z.string().describe('Template name used to generate the render.').nullable().optional(),
    createdAt: z.string().describe('Timestamp when the render was created.').nullable().optional(),
    externalId: z.string().describe('External identifier associated with the render.').nullable().optional(),
  }).describe('Templated render.')).describe('Render objects returned by Templated after normalization.'),
}).describe('Normalized Templated render creation result.')

export const listRendersInput = z.strictObject({}).describe('Action input.')

export const listRendersOutput = z.strictObject({
  renders: z.array(z.looseObject({
    id: z.string().describe('Unique identifier of the render.').optional(),
    url: z.string().describe('URL of the rendered asset.').nullable().optional(),
    width: z.int().describe('Rendered width in pixels.').nullable().optional(),
    height: z.int().describe('Rendered height in pixels.').nullable().optional(),
    name: z.string().describe('Render name.').nullable().optional(),
    status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).describe('Current render status reported by Templated.').optional(),
    format: z.string().describe('Output format of the render.').nullable().optional(),
    templateId: z.string().describe('Template identifier used to generate the render.').nullable().optional(),
    templateName: z.string().describe('Template name used to generate the render.').nullable().optional(),
    createdAt: z.string().describe('Timestamp when the render was created.').nullable().optional(),
    externalId: z.string().describe('External identifier associated with the render.').nullable().optional(),
  }).describe('Templated render.')).describe('Renders returned by Templated.'),
}).describe('Templated render list.')

export const getRenderInput = z.strictObject({
  renderId: z.string().min(1).describe('The render ID.'),
}).describe('Action input.')

export const getRenderOutput = z.strictObject({
  render: z.looseObject({
    id: z.string().describe('Unique identifier of the render.').optional(),
    url: z.string().describe('URL of the rendered asset.').nullable().optional(),
    width: z.int().describe('Rendered width in pixels.').nullable().optional(),
    height: z.int().describe('Rendered height in pixels.').nullable().optional(),
    name: z.string().describe('Render name.').nullable().optional(),
    status: z.enum(['PENDING', 'COMPLETED', 'FAILED']).describe('Current render status reported by Templated.').optional(),
    format: z.string().describe('Output format of the render.').nullable().optional(),
    templateId: z.string().describe('Template identifier used to generate the render.').nullable().optional(),
    templateName: z.string().describe('Template name used to generate the render.').nullable().optional(),
    createdAt: z.string().describe('Timestamp when the render was created.').nullable().optional(),
    externalId: z.string().describe('External identifier associated with the render.').nullable().optional(),
  }).describe('Templated render.'),
}).describe('Single Templated render.')

export const deleteRenderInput = z.strictObject({
  renderId: z.string().min(1).describe('The render ID.'),
}).describe('Action input.')

export const deleteRenderOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the render delete request succeeded.'),
  renderId: z.string().describe('Identifier of the deleted render.'),
}).describe('Templated render delete acknowledgement.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const templatedActions = {
  get_account: {
    description: 'Get the current Templated account associated with the API key.',
    effect: 'read',
    inputSchema: getAccountInput,
    outputSchema: z.toJSONSchema(getAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_templates: {
    description: 'List Templated templates with optional filters for name, dimensions, and tags.',
    effect: 'read',
    inputSchema: listTemplatesInput,
    outputSchema: z.toJSONSchema(listTemplatesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_template: {
    description: 'Retrieve a single Templated template by its template ID.',
    effect: 'read',
    inputSchema: getTemplateInput,
    outputSchema: z.toJSONSchema(getTemplateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_render: {
    description: 'Create a Templated render from one template with optional shared layer overrides and image or PDF output settings.',
    effect: 'write',
    inputSchema: createRenderInput,
    outputSchema: z.toJSONSchema(createRenderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_renders: {
    description: 'List all renders owned by the current Templated account.',
    effect: 'read',
    inputSchema: listRendersInput,
    outputSchema: z.toJSONSchema(listRendersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_render: {
    description: 'Retrieve a single Templated render by its render ID.',
    effect: 'read',
    inputSchema: getRenderInput,
    outputSchema: z.toJSONSchema(getRenderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_render: {
    description: 'Delete a Templated render by its render ID.',
    effect: 'destructive',
    inputSchema: deleteRenderInput,
    outputSchema: z.toJSONSchema(deleteRenderOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
