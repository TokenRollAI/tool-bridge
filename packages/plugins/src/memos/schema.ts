/**
 * Memos 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

// 手写豁免(见 handwritten.json):update_memo

export const createMemoInput = z.strictObject({
  content: z.string().min(1).describe('The memo content in Markdown format.'),
  visibility: z.enum(['PRIVATE', 'PROTECTED', 'PUBLIC']).describe('The memo visibility.').optional(),
  memoId: z.string().min(1).max(36).describe('An optional caller-selected memo ID.').optional(),
  createTime: z.iso.datetime({ offset: true }).describe('An optional creation time for imported content.').optional(),
  pinned: z.boolean().describe('Whether the new memo should be pinned.').optional(),
  location: z.strictObject({
    placeholder: z.string().describe('The location label.').optional(),
    latitude: z.number().describe('The latitude in decimal degrees.').optional(),
    longitude: z.number().describe('The longitude in decimal degrees.').optional(),
  }).describe('A geographic location to attach to a memo.').optional(),
}).describe('Input parameters for creating a memo.')

export const createMemoOutput = z.strictObject({
  memo: z.looseObject({
    name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    state: z.string().describe('The memo state returned by Memos.').optional(),
    creator: z.string().min(7).describe('The Memos user resource name in the format users/{user}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The memo creation time.').optional(),
    updateTime: z.iso.datetime({ offset: true }).describe('The memo update time.').optional(),
    content: z.string().describe('The memo Markdown content.').optional(),
    visibility: z.string().describe('The memo visibility returned by Memos.').optional(),
    tags: z.array(z.string().describe('An extracted memo tag.')).describe('Tags extracted from the memo content.').optional(),
    pinned: z.boolean().describe('Whether the memo is pinned.').optional(),
    attachments: z.array(z.looseObject({
      name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
      createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
      filename: z.string().describe('The attachment filename.').optional(),
      externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
      type: z.string().describe('The attachment MIME type.').optional(),
      size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
      memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    }).describe('Memos attachment metadata.')).describe('Attachments associated with the memo.').optional(),
    parent: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    snippet: z.string().describe('A plain-text preview of the memo content.').optional(),
    location: z.looseObject({
      placeholder: z.string().describe('The location label.').optional(),
      latitude: z.number().describe('The latitude in decimal degrees.').optional(),
      longitude: z.number().describe('The longitude in decimal degrees.').optional(),
    }).describe('A geographic location attached to a memo.').optional(),
    property: z.looseObject({}).describe('Computed memo properties.').optional(),
  }).describe('A Memos memo resource.'),
}).describe('The created memo response.')

export const listMemosInput = z.strictObject({
  pageSize: z.int().min(1).max(1000).describe('The maximum number of resources to return.').optional(),
  pageToken: z.string().min(1).describe('The continuation token returned by a previous list action.').optional(),
  state: z.enum(['NORMAL', 'ARCHIVED']).describe('The memo state.').optional(),
  orderBy: z.string().min(1).describe('The AIP-132 ordering expression, such as pinned desc, create_time desc.').optional(),
  filter: z.string().min(1).describe('The Memos CEL filter expression, including content, creator, visibility, tags, timestamps, and computed properties.').optional(),
  showDeleted: z.boolean().describe('Whether deleted memos should be included.').optional(),
}).describe('Input parameters for listing memos.')

export const listMemosOutput = z.strictObject({
  memos: z.array(z.looseObject({
    name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    state: z.string().describe('The memo state returned by Memos.').optional(),
    creator: z.string().min(7).describe('The Memos user resource name in the format users/{user}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The memo creation time.').optional(),
    updateTime: z.iso.datetime({ offset: true }).describe('The memo update time.').optional(),
    content: z.string().describe('The memo Markdown content.').optional(),
    visibility: z.string().describe('The memo visibility returned by Memos.').optional(),
    tags: z.array(z.string().describe('An extracted memo tag.')).describe('Tags extracted from the memo content.').optional(),
    pinned: z.boolean().describe('Whether the memo is pinned.').optional(),
    attachments: z.array(z.looseObject({
      name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
      createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
      filename: z.string().describe('The attachment filename.').optional(),
      externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
      type: z.string().describe('The attachment MIME type.').optional(),
      size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
      memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    }).describe('Memos attachment metadata.')).describe('Attachments associated with the memo.').optional(),
    parent: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    snippet: z.string().describe('A plain-text preview of the memo content.').optional(),
    location: z.looseObject({
      placeholder: z.string().describe('The location label.').optional(),
      latitude: z.number().describe('The latitude in decimal degrees.').optional(),
      longitude: z.number().describe('The longitude in decimal degrees.').optional(),
    }).describe('A geographic location attached to a memo.').optional(),
    property: z.looseObject({}).describe('Computed memo properties.').optional(),
  }).describe('A Memos memo resource.')).describe('The memos returned by the instance.'),
  nextPageToken: z.string().describe('The continuation token for the next page, or null when no next page exists.').nullable(),
}).describe('A page of Memos memo resources.')

export const getMemoInput = z.strictObject({
  name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.'),
}).describe('Input parameters for reading a memo.')

export const getMemoOutput = z.strictObject({
  memo: z.looseObject({
    name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    state: z.string().describe('The memo state returned by Memos.').optional(),
    creator: z.string().min(7).describe('The Memos user resource name in the format users/{user}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The memo creation time.').optional(),
    updateTime: z.iso.datetime({ offset: true }).describe('The memo update time.').optional(),
    content: z.string().describe('The memo Markdown content.').optional(),
    visibility: z.string().describe('The memo visibility returned by Memos.').optional(),
    tags: z.array(z.string().describe('An extracted memo tag.')).describe('Tags extracted from the memo content.').optional(),
    pinned: z.boolean().describe('Whether the memo is pinned.').optional(),
    attachments: z.array(z.looseObject({
      name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
      createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
      filename: z.string().describe('The attachment filename.').optional(),
      externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
      type: z.string().describe('The attachment MIME type.').optional(),
      size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
      memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    }).describe('Memos attachment metadata.')).describe('Attachments associated with the memo.').optional(),
    parent: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
    snippet: z.string().describe('A plain-text preview of the memo content.').optional(),
    location: z.looseObject({
      placeholder: z.string().describe('The location label.').optional(),
      latitude: z.number().describe('The latitude in decimal degrees.').optional(),
      longitude: z.number().describe('The longitude in decimal degrees.').optional(),
    }).describe('A geographic location attached to a memo.').optional(),
    property: z.looseObject({}).describe('Computed memo properties.').optional(),
  }).describe('A Memos memo resource.'),
}).describe('The memo response.')

export const deleteMemoInput = z.strictObject({
  name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.'),
  force: z.boolean().describe('Whether to force deletion when the memo has associated data.').optional(),
}).describe('Input parameters for deleting a memo.')

export const deleteMemoOutput = z.strictObject({
  deleted: z.boolean().describe('Whether Memos accepted the deletion.'),
  name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.'),
}).describe('The memo deletion result.')

export const uploadAttachmentInput = z.strictObject({
  fileUrl: z.url().describe('The public HTTP or HTTPS URL of the file to upload.'),
  filename: z.string().min(1).describe('The filename to store in Memos.'),
  type: z.string().min(1).describe('The MIME type; inferred from the download response when omitted.').optional(),
  memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
  attachmentId: z.string().min(1).max(36).describe('An optional caller-selected attachment ID.').optional(),
}).describe('Input parameters for uploading an attachment from a URL.')

export const uploadAttachmentOutput = z.strictObject({
  attachment: z.looseObject({
    name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
    filename: z.string().describe('The attachment filename.').optional(),
    externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
    type: z.string().describe('The attachment MIME type.').optional(),
    size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
    memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
  }).describe('Memos attachment metadata.'),
}).describe('The uploaded attachment response.')

export const listAttachmentsInput = z.strictObject({
  pageSize: z.int().min(1).max(1000).describe('The maximum number of resources to return.').optional(),
  pageToken: z.string().min(1).describe('The continuation token returned by a previous list action.').optional(),
  filter: z.string().min(1).describe('The Memos attachment filter expression.').optional(),
  orderBy: z.string().min(1).describe('The attachment ordering expression, such as create_time desc.').optional(),
}).describe('Input parameters for listing attachments.')

export const listAttachmentsOutput = z.strictObject({
  attachments: z.array(z.looseObject({
    name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
    filename: z.string().describe('The attachment filename.').optional(),
    externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
    type: z.string().describe('The attachment MIME type.').optional(),
    size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
    memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
  }).describe('Memos attachment metadata.')).describe('The attachments returned by Memos.'),
  nextPageToken: z.string().describe('The continuation token for the next page, or null when no next page exists.').nullable(),
}).describe('A page of Memos attachment metadata.')

export const getAttachmentInput = z.strictObject({
  name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.'),
}).describe('Input parameters for reading an attachment.')

export const getAttachmentOutput = z.strictObject({
  attachment: z.looseObject({
    name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
    filename: z.string().describe('The attachment filename.').optional(),
    externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
    type: z.string().describe('The attachment MIME type.').optional(),
    size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
    memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
  }).describe('Memos attachment metadata.'),
}).describe('The attachment metadata response.')

export const deleteAttachmentInput = z.strictObject({
  name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.'),
}).describe('Input parameters for deleting an attachment.')

export const deleteAttachmentOutput = z.strictObject({
  deleted: z.boolean().describe('Whether Memos accepted the deletion.'),
  name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.'),
}).describe('The attachment deletion result.')

export const listMemoAttachmentsInput = z.strictObject({
  name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.'),
  pageSize: z.int().min(1).max(1000).describe('The maximum number of resources to return.').optional(),
  pageToken: z.string().min(1).describe('The continuation token returned by a previous list action.').optional(),
}).describe('Input parameters for listing a memo\'s attachments.')

export const listMemoAttachmentsOutput = z.strictObject({
  attachments: z.array(z.looseObject({
    name: z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The attachment creation time.').optional(),
    filename: z.string().describe('The attachment filename.').optional(),
    externalLink: z.string().describe('The external storage URL when returned by Memos.').optional(),
    type: z.string().describe('The attachment MIME type.').optional(),
    size: z.string().describe('The attachment size in bytes, encoded as a string by the Memos API.').optional(),
    memo: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.').optional(),
  }).describe('Memos attachment metadata.')).describe('The memo attachments returned by Memos.'),
  nextPageToken: z.string().describe('The continuation token for the next page, or null when no next page exists.').nullable(),
}).describe('A page of attachments associated with the memo.')

export const setMemoAttachmentsInput = z.strictObject({
  name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.'),
  attachmentNames: z.array(z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.')).describe('The complete desired list of attachment resource names; use an empty array to clear all attachments.'),
}).describe('Input parameters for replacing a memo\'s attachment set.')

export const setMemoAttachmentsOutput = z.strictObject({
  updated: z.boolean().describe('Whether Memos accepted the attachment replacement.'),
  name: z.string().min(7).describe('The Memos memo resource name in the format memos/{memo}.'),
  attachmentNames: z.array(z.string().min(13).describe('The Memos attachment resource name in the format attachments/{attachment}.')).describe('The attachment resource names sent to Memos.'),
}).describe('The memo attachment replacement result.')

export const getCurrentUserInput = z.strictObject({}).describe('The input payload for reading the current Memos user.')

export const getCurrentUserOutput = z.strictObject({
  user: z.looseObject({
    name: z.string().min(7).describe('The Memos user resource name in the format users/{user}.').optional(),
    role: z.string().describe('The user role returned by Memos.').optional(),
    username: z.string().describe('The unique Memos username.').optional(),
    email: z.string().describe('The user\'s email address.').optional(),
    displayName: z.string().describe('The user\'s display name.').optional(),
    avatarUrl: z.string().describe('The user\'s avatar URL.').optional(),
    description: z.string().describe('The user\'s profile description.').optional(),
    state: z.string().describe('The user state returned by Memos.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The user creation time.').optional(),
    updateTime: z.iso.datetime({ offset: true }).describe('The user update time.').optional(),
  }).describe('A Memos user resource.'),
}).describe('The current Memos user response.')

export const listUsersInput = z.strictObject({
  pageSize: z.int().min(1).max(1000).describe('The maximum number of resources to return.').optional(),
  pageToken: z.string().min(1).describe('The continuation token returned by a previous list action.').optional(),
  filter: z.string().min(1).describe('The user filter expression; Memos v0.29 supports username equality.').optional(),
  showDeleted: z.boolean().describe('Whether deleted users should be included.').optional(),
}).describe('Input parameters for listing Memos users.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.looseObject({
    name: z.string().min(7).describe('The Memos user resource name in the format users/{user}.').optional(),
    role: z.string().describe('The user role returned by Memos.').optional(),
    username: z.string().describe('The unique Memos username.').optional(),
    email: z.string().describe('The user\'s email address.').optional(),
    displayName: z.string().describe('The user\'s display name.').optional(),
    avatarUrl: z.string().describe('The user\'s avatar URL.').optional(),
    description: z.string().describe('The user\'s profile description.').optional(),
    state: z.string().describe('The user state returned by Memos.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The user creation time.').optional(),
    updateTime: z.iso.datetime({ offset: true }).describe('The user update time.').optional(),
  }).describe('A Memos user resource.')).describe('The users returned by Memos.'),
  nextPageToken: z.string().describe('The continuation token for the next page, or null when no next page exists.').nullable(),
}).describe('A page of Memos users.')

export const getUserInput = z.strictObject({
  name: z.string().min(7).describe('The Memos user resource name in the format users/{user}.'),
  readMask: z.string().min(1).describe('An optional comma-separated field mask for the user response.').optional(),
}).describe('Input parameters for reading a Memos user.')

export const getUserOutput = z.strictObject({
  user: z.looseObject({
    name: z.string().min(7).describe('The Memos user resource name in the format users/{user}.').optional(),
    role: z.string().describe('The user role returned by Memos.').optional(),
    username: z.string().describe('The unique Memos username.').optional(),
    email: z.string().describe('The user\'s email address.').optional(),
    displayName: z.string().describe('The user\'s display name.').optional(),
    avatarUrl: z.string().describe('The user\'s avatar URL.').optional(),
    description: z.string().describe('The user\'s profile description.').optional(),
    state: z.string().describe('The user state returned by Memos.').optional(),
    createTime: z.iso.datetime({ offset: true }).describe('The user creation time.').optional(),
    updateTime: z.iso.datetime({ offset: true }).describe('The user update time.').optional(),
  }).describe('A Memos user resource.'),
}).describe('The Memos user response.')

import { updateMemoInput, updateMemoOutput } from './schema.handwritten'

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const memosActions = {
  create_memo: {
    description: 'Create a Markdown memo on the connected Memos instance.',
    effect: 'write',
    inputSchema: createMemoInput,
    outputSchema: z.toJSONSchema(createMemoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_memos: {
    description: 'List memos with pagination, state selection, ordering, and CEL filtering.',
    effect: 'read',
    inputSchema: listMemosInput,
    outputSchema: z.toJSONSchema(listMemosOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_memo: {
    description: 'Retrieve one memo by its Memos resource name.',
    effect: 'read',
    inputSchema: getMemoInput,
    outputSchema: z.toJSONSchema(getMemoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_memo: {
    description: 'Update selected content, visibility, pin, state, time, or location fields on a memo.',
    effect: 'write',
    inputSchema: updateMemoInput,
    outputSchema: z.toJSONSchema(updateMemoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_memo: {
    description: 'Delete one memo, optionally forcing deletion when associated data exists.',
    effect: 'destructive',
    inputSchema: deleteMemoInput,
    outputSchema: z.toJSONSchema(deleteMemoOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upload_attachment: {
    description: 'Download a public file URL and upload its bytes to the connected Memos instance.',
    effect: 'write',
    inputSchema: uploadAttachmentInput,
    outputSchema: z.toJSONSchema(uploadAttachmentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_attachments: {
    description: 'List attachment metadata with pagination, filtering, and ordering.',
    effect: 'read',
    inputSchema: listAttachmentsInput,
    outputSchema: z.toJSONSchema(listAttachmentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_attachment: {
    description: 'Retrieve one attachment\'s metadata by resource name.',
    effect: 'read',
    inputSchema: getAttachmentInput,
    outputSchema: z.toJSONSchema(getAttachmentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_attachment: {
    description: 'Delete one attachment by resource name.',
    effect: 'destructive',
    inputSchema: deleteAttachmentInput,
    outputSchema: z.toJSONSchema(deleteAttachmentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_memo_attachments: {
    description: 'List attachments associated with one memo.',
    effect: 'read',
    inputSchema: listMemoAttachmentsInput,
    outputSchema: z.toJSONSchema(listMemoAttachmentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_memo_attachments: {
    description: 'Replace the complete attachment set associated with one memo.',
    effect: 'write',
    inputSchema: setMemoAttachmentsInput,
    outputSchema: z.toJSONSchema(setMemoAttachmentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_user: {
    description: 'Retrieve the Memos user associated with the connected personal access token.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_users: {
    description: 'List users visible to the connected Memos account.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Retrieve one Memos user by resource name.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
