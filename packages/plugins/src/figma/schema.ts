/**
 * Figma 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

// 手写豁免(见 handwritten.json):update_dev_resources

export const getCurrentUserInput = z.strictObject({}).describe('No input is required to get the current Figma user.')

export const getCurrentUserOutput = z.strictObject({
  user: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('The current Figma user returned by the connector.')

export const getFileMetadataInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
}).describe('Input parameters for reading Figma file metadata.')

export const getFileMetadataOutput = z.strictObject({
  metadata: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma file metadata returned by the connector.')

export const getFileInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  version: z.string().min(1).describe('A specific Figma file version ID to read.').optional(),
  nodeIds: z.array(z.string().min(1).describe('A Figma node ID.')).min(1).describe('Figma node IDs to fetch or render, for example `1:2` or `123:456`.').optional(),
  depth: z.int().min(1).describe('The maximum depth of the document tree to return from Figma.').optional(),
  geometry: z.enum(['paths']).describe('Whether Figma should include vector path geometry.').optional(),
  pluginData: z.array(z.string().min(1).describe('A Figma plugin ID.')).min(1).describe('Plugin IDs whose plugin data Figma should include.').optional(),
  branchData: z.boolean().describe('Whether Figma should include branch metadata in the response.').optional(),
}).describe('Input parameters for reading a Figma file document.')

export const getFileOutput = z.strictObject({
  file: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma file JSON returned by the connector.')

export const getFileNodesInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  nodeIds: z.array(z.string().min(1).describe('A Figma node ID.')).min(1).describe('Figma node IDs to fetch or render, for example `1:2` or `123:456`.'),
  version: z.string().min(1).describe('A specific Figma file version ID to read.').optional(),
  depth: z.int().min(1).describe('The maximum depth of the document tree to return from Figma.').optional(),
  geometry: z.enum(['paths']).describe('Whether Figma should include vector path geometry.').optional(),
  pluginData: z.array(z.string().min(1).describe('A Figma plugin ID.')).min(1).describe('Plugin IDs whose plugin data Figma should include.').optional(),
}).describe('Input parameters for reading selected Figma nodes.')

export const getFileNodesOutput = z.strictObject({
  nodes: z.record(z.string(), z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('Figma nodes keyed by node ID.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma node JSON returned by the connector.')

export const renderImagesInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  nodeIds: z.array(z.string().min(1).describe('A Figma node ID.')).min(1).describe('Figma node IDs to fetch or render, for example `1:2` or `123:456`.'),
  version: z.string().min(1).describe('A specific Figma file version ID to read.').optional(),
  scale: z.number().min(0.01).max(4).describe('The image scale factor supported by Figma.').optional(),
  format: z.enum(['jpg', 'png', 'svg', 'pdf']).describe('The image format Figma should render.').optional(),
  svgIncludeId: z.boolean().describe('Whether SVG exports should include Figma node IDs.').optional(),
  svgSimplifyStroke: z.boolean().describe('Whether SVG exports should simplify inside and outside strokes.').optional(),
  useAbsoluteBounds: z.boolean().describe('Whether Figma should use full node bounds when rendering.').optional(),
}).describe('Input parameters for rendering Figma file nodes.')

export const renderImagesOutput = z.strictObject({
  images: z.record(z.string(), z.string().describe('The rendered image URL for a Figma node.').nullable()).describe('Rendered image URLs keyed by node ID. Missing or failed renders may be null.'),
  err: z.string().describe('The image rendering error returned by Figma.').nullable(),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma image rendering URLs returned by the connector.')

export const getImageFillsInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
}).describe('Input parameters for reading Figma image fill URLs.')

export const getImageFillsOutput = z.strictObject({
  images: z.record(z.string(), z.string().describe('The temporary image fill URL.')).describe('Image fill URLs keyed by Figma image reference.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma image fill URLs returned by the connector.')

export const listFileVersionsInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  pageSize: z.int().min(1).describe('The maximum number of versions to request from Figma.').optional(),
  before: z.string().min(1).describe('A pagination cursor requesting versions before this cursor.').optional(),
  after: z.string().min(1).describe('A pagination cursor requesting versions after this cursor.').optional(),
}).describe('Input parameters for listing Figma file versions.')

export const listFileVersionsOutput = z.strictObject({
  versions: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The Figma file versions.'),
  pagination: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma file versions returned by the connector.')

export const listCommentsInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
}).describe('Input parameters for listing Figma comments.')

export const listCommentsOutput = z.strictObject({
  comments: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The comments returned by Figma.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma comments returned by the connector.')

export const postCommentInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  message: z.string().min(1).describe('The comment message to post.'),
  clientMeta: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.').optional(),
  commentId: z.string().min(1).describe('An optional parent comment ID to reply to.').optional(),
}).describe('Input parameters for posting a Figma comment.')

export const postCommentOutput = z.strictObject({
  comment: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('A Figma comment result returned by the connector.')

export const deleteCommentInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  commentId: z.string().min(1).describe('The Figma comment ID.'),
}).describe('Input parameters for deleting a Figma comment.')

export const deleteCommentOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request completed successfully.'),
}).describe('The result of deleting a Figma comment.')

export const listCommentReactionsInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  commentId: z.string().min(1).describe('The Figma comment ID.'),
  cursor: z.string().min(1).describe('A pagination cursor returned by Figma.').optional(),
}).describe('Input parameters for listing Figma comment reactions.')

export const listCommentReactionsOutput = z.strictObject({
  reactions: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  pagination: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma comment reactions returned by the connector.')

export const postCommentReactionInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  commentId: z.string().min(1).describe('The Figma comment ID.'),
  emoji: z.string().min(1).describe('The emoji reaction shortcode to add or delete.'),
}).describe('Input parameters for adding a Figma comment reaction.')

export const postCommentReactionOutput = z.strictObject({
  posted: z.boolean().describe('Whether the reaction request completed successfully.'),
}).describe('A Figma comment reaction result.')

export const deleteCommentReactionInput = z.strictObject({
  fileKey: z.string().min(1).describe('The Figma file key or branch key from a Figma file URL.'),
  commentId: z.string().min(1).describe('The Figma comment ID.'),
  emoji: z.string().min(1).describe('The emoji reaction shortcode to add or delete.'),
}).describe('Input parameters for deleting a Figma comment reaction.')

export const deleteCommentReactionOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request completed successfully.'),
}).describe('The result of deleting a Figma comment reaction.')

export const listTeamProjectsInput = z.strictObject({
  teamId: z.string().min(1).describe('The Figma team ID from a Figma team URL.'),
}).describe('Input parameters for listing Figma team projects.')

export const listTeamProjectsOutput = z.strictObject({
  projects: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma projects returned by the connector.')

export const getProjectMetadataInput = z.strictObject({
  projectId: z.string().min(1).describe('The Figma project ID.'),
}).describe('Input parameters for reading Figma project metadata.')

export const getProjectMetadataOutput = z.strictObject({
  metadata: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma project metadata returned by the connector.')

export const listProjectFilesInput = z.strictObject({
  projectId: z.string().min(1).describe('The Figma project ID.'),
  branchData: z.boolean().describe('Whether Figma should include branch metadata for files.').optional(),
}).describe('Input parameters for listing Figma project files.')

export const listProjectFilesOutput = z.strictObject({
  files: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma project files returned by the connector.')

export const listFileComponentsInput = z.strictObject({
  fileKey: z.string().min(1).describe('The main Figma file key from a Figma file URL.'),
}).describe('Input parameters for listing Figma file components.')

export const listFileComponentsOutput = z.strictObject({
  items: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  pagination: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma library items returned by the connector.')

export const listFileComponentSetsInput = z.strictObject({
  fileKey: z.string().min(1).describe('The main Figma file key from a Figma file URL.'),
}).describe('Input parameters for listing Figma file component sets.')

export const listFileComponentSetsOutput = z.strictObject({
  items: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  pagination: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma library items returned by the connector.')

export const listFileStylesInput = z.strictObject({
  fileKey: z.string().min(1).describe('The main Figma file key from a Figma file URL.'),
}).describe('Input parameters for listing Figma file styles.')

export const listFileStylesOutput = z.strictObject({
  items: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  pagination: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma library items returned by the connector.')

export const getComponentInput = z.strictObject({
  key: z.string().min(1).describe('The unique Figma library asset key.'),
}).describe('Input parameters for reading a Figma component.')

export const getComponentOutput = z.strictObject({
  item: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('A Figma library item returned by the connector.')

export const getComponentSetInput = z.strictObject({
  key: z.string().min(1).describe('The unique Figma library asset key.'),
}).describe('Input parameters for reading a Figma component set.')

export const getComponentSetOutput = z.strictObject({
  item: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('A Figma library item returned by the connector.')

export const getStyleInput = z.strictObject({
  key: z.string().min(1).describe('The unique Figma library asset key.'),
}).describe('Input parameters for reading a Figma style.')

export const getStyleOutput = z.strictObject({
  item: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('A Figma library item returned by the connector.')

export const getDevResourcesInput = z.strictObject({
  fileKey: z.string().min(1).describe('The main Figma file key from a Figma file URL.'),
  nodeIds: z.array(z.string().min(1).describe('A Figma node ID.')).min(1).describe('Figma node IDs to fetch or render, for example `1:2` or `123:456`.').optional(),
}).describe('Input parameters for reading Figma dev resources.')

export const getDevResourcesOutput = z.strictObject({
  devResources: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('Figma dev resources returned by the connector.')

export const createDevResourcesInput = z.strictObject({
  devResources: z.array(z.strictObject({
    name: z.string().min(1).describe('The display name for the dev resource.'),
    url: z.url().describe('The URL of the dev resource.'),
    fileKey: z.string().min(1).describe('The main Figma file key from a Figma file URL.'),
    nodeId: z.string().min(1).describe('The Figma node ID to attach the dev resource to.'),
  }).describe('A Figma dev resource to create.')).min(1).describe('The dev resources to create.'),
}).describe('Input parameters for creating Figma dev resources.')

export const createDevResourcesOutput = z.strictObject({
  linksCreated: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  linksUpdated: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  errors: z.array(z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.')).describe('The raw JSON array returned by the Figma API.'),
  raw: z.record(z.string(), z.unknown().describe('A raw Figma API value.')).describe('The raw JSON object returned by the Figma API.'),
}).describe('The result of creating or updating Figma dev resources.')

export const deleteDevResourceInput = z.strictObject({
  fileKey: z.string().min(1).describe('The main Figma file key from a Figma file URL.'),
  devResourceId: z.string().min(1).describe('The Figma dev resource ID to delete.'),
}).describe('Input parameters for deleting a Figma dev resource.')

export const deleteDevResourceOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request completed successfully.'),
}).describe('The result of deleting a Figma dev resource.')

import { updateDevResourcesInput, updateDevResourcesOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const figmaActions = {
  get_current_user: {
    description: 'Get the current Figma user associated with the credential.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_file_metadata: {
    description: 'Get lightweight metadata for a Figma file without fetching its full document.',
    effect: 'read',
    inputSchema: getFileMetadataInput,
    outputSchema: z.toJSONSchema(getFileMetadataOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_file: {
    description: 'Get the JSON document for a Figma file or branch.',
    effect: 'read',
    inputSchema: getFileInput,
    outputSchema: z.toJSONSchema(getFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_file_nodes: {
    description: 'Get JSON for selected node IDs from a Figma file or branch.',
    effect: 'read',
    inputSchema: getFileNodesInput,
    outputSchema: z.toJSONSchema(getFileNodesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  render_images: {
    description: 'Render selected Figma file nodes and return temporary image URLs.',
    effect: 'write',
    inputSchema: renderImagesInput,
    outputSchema: z.toJSONSchema(renderImagesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_image_fills: {
    description: 'Get temporary download URLs for image fills used in a Figma file.',
    effect: 'read',
    inputSchema: getImageFillsInput,
    outputSchema: z.toJSONSchema(getImageFillsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_file_versions: {
    description: 'List version history records for a Figma file.',
    effect: 'read',
    inputSchema: listFileVersionsInput,
    outputSchema: z.toJSONSchema(listFileVersionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_comments: {
    description: 'List comments on a Figma file or branch.',
    effect: 'read',
    inputSchema: listCommentsInput,
    outputSchema: z.toJSONSchema(listCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  post_comment: {
    description: 'Post a comment on a Figma file or branch.',
    effect: 'write',
    inputSchema: postCommentInput,
    outputSchema: z.toJSONSchema(postCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_comment: {
    description: 'Delete a Figma comment created by the authenticated user.',
    effect: 'destructive',
    inputSchema: deleteCommentInput,
    outputSchema: z.toJSONSchema(deleteCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_comment_reactions: {
    description: 'List emoji reactions on a Figma file comment.',
    effect: 'read',
    inputSchema: listCommentReactionsInput,
    outputSchema: z.toJSONSchema(listCommentReactionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  post_comment_reaction: {
    description: 'Add an emoji reaction to a Figma file comment.',
    effect: 'write',
    inputSchema: postCommentReactionInput,
    outputSchema: z.toJSONSchema(postCommentReactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_comment_reaction: {
    description: 'Delete an emoji reaction created by the authenticated user.',
    effect: 'destructive',
    inputSchema: deleteCommentReactionInput,
    outputSchema: z.toJSONSchema(deleteCommentReactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_team_projects: {
    description: 'List projects visible to the authenticated user in a Figma team.',
    effect: 'read',
    inputSchema: listTeamProjectsInput,
    outputSchema: z.toJSONSchema(listTeamProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project_metadata: {
    description: 'Get metadata for a Figma project.',
    effect: 'read',
    inputSchema: getProjectMetadataInput,
    outputSchema: z.toJSONSchema(getProjectMetadataOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_project_files: {
    description: 'List files in a Figma project.',
    effect: 'read',
    inputSchema: listProjectFilesInput,
    outputSchema: z.toJSONSchema(listProjectFilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_file_components: {
    description: 'List published components in a Figma main file library.',
    effect: 'read',
    inputSchema: listFileComponentsInput,
    outputSchema: z.toJSONSchema(listFileComponentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_file_component_sets: {
    description: 'List published component sets in a Figma main file library.',
    effect: 'read',
    inputSchema: listFileComponentSetsInput,
    outputSchema: z.toJSONSchema(listFileComponentSetsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_file_styles: {
    description: 'List published styles in a Figma main file library.',
    effect: 'read',
    inputSchema: listFileStylesInput,
    outputSchema: z.toJSONSchema(listFileStylesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_component: {
    description: 'Get metadata for a published Figma component by key.',
    effect: 'read',
    inputSchema: getComponentInput,
    outputSchema: z.toJSONSchema(getComponentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_component_set: {
    description: 'Get metadata for a published Figma component set by key.',
    effect: 'read',
    inputSchema: getComponentSetInput,
    outputSchema: z.toJSONSchema(getComponentSetOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_style: {
    description: 'Get metadata for a published Figma style by key.',
    effect: 'read',
    inputSchema: getStyleInput,
    outputSchema: z.toJSONSchema(getStyleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_dev_resources: {
    description: 'Get dev resources attached to a Figma main file.',
    effect: 'read',
    inputSchema: getDevResourcesInput,
    outputSchema: z.toJSONSchema(getDevResourcesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_dev_resources: {
    description: 'Create dev resources and attach them to Figma file nodes.',
    effect: 'write',
    inputSchema: createDevResourcesInput,
    outputSchema: z.toJSONSchema(createDevResourcesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_dev_resources: {
    description: 'Update existing Figma dev resources.',
    effect: 'write',
    inputSchema: updateDevResourcesInput,
    outputSchema: z.toJSONSchema(updateDevResourcesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_dev_resource: {
    description: 'Delete a Figma dev resource from a main file.',
    effect: 'destructive',
    inputSchema: deleteDevResourceInput,
    outputSchema: z.toJSONSchema(deleteDevResourceOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
