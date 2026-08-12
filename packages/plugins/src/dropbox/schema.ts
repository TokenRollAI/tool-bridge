/**
 * Dropbox 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCurrentAccountInput = z.strictObject({}).describe('No input is required for this action.')

export const getCurrentAccountOutput = z.strictObject({
  accountId: z.string().describe('The Dropbox account ID.'),
  displayName: z.string().describe('The full display name of the current user.'),
  abbreviatedName: z.string().describe('The abbreviated display name when available.').nullable(),
  givenName: z.string().describe('The given name when available.').nullable(),
  surname: z.string().describe('The surname when available.').nullable(),
  email: z.string().describe('The email address when available.').nullable(),
  emailVerified: z.boolean().describe('Whether the Dropbox account email is verified.').nullable(),
  disabled: z.boolean().describe('Whether the Dropbox account is disabled.'),
  locale: z.string().describe('The account locale when available.').nullable(),
  country: z.string().describe('The account country when available.').nullable(),
  accountType: z.string().describe('The Dropbox account type tag when available.').nullable(),
  teamId: z.string().describe('The Dropbox team ID when available.').nullable(),
  teamName: z.string().describe('The Dropbox team name when available.').nullable(),
}).describe('Normalized current-account information from Dropbox.')

export const listFolderInput = z.strictObject({
  path: z.string().describe('The folder path to list. Leave empty or omit it to list the root folder.').optional(),
  recursive: z.boolean().describe('Whether to list subfolders recursively.').optional(),
  includeDeleted: z.boolean().describe('Whether deleted entries should be included.').optional(),
  includeMountedFolders: z.boolean().describe('Whether mounted folders should be included in the response.').optional(),
  includeHasExplicitSharedMembers: z.boolean().describe('Whether Dropbox should include explicit shared-member flags when available.').optional(),
  limit: z.int().min(1).max(2000).describe('The maximum number of entries to return per page.').optional(),
}).describe('Input payload for listing a Dropbox folder.')

export const listFolderOutput = z.strictObject({
  entries: z.array(z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.')).describe('The Dropbox entries returned in this page.'),
  cursor: z.string().describe('The cursor for continuing the listing.'),
  hasMore: z.boolean().describe('Whether more entries are available.'),
}).describe('A Dropbox folder listing page.')

export const listFolderContinueInput = z.strictObject({
  cursor: z.string().min(1).regex(new RegExp('\\S')).describe('The cursor returned by a previous Dropbox folder listing.'),
}).describe('Input payload for continuing a Dropbox folder listing.')

export const listFolderContinueOutput = z.strictObject({
  entries: z.array(z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.')).describe('The Dropbox entries returned in this page.'),
  cursor: z.string().describe('The cursor for continuing the listing.'),
  hasMore: z.boolean().describe('Whether more entries are available.'),
}).describe('A Dropbox folder listing page.')

export const getMetadataInput = z.strictObject({
  path: z.string().describe('A Dropbox path, file ID, revision ID, or namespace-relative path.'),
  includeDeleted: z.boolean().describe('Whether deleted metadata is allowed.').optional(),
  includeHasExplicitSharedMembers: z.boolean().describe('Whether Dropbox should include explicit shared-member flags when available.').optional(),
}).describe('Input payload for retrieving Dropbox metadata.')

export const getMetadataOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A normalized Dropbox metadata wrapper.')

export const downloadFileInput = z.strictObject({
  path: z.string().describe('The Dropbox file path, file ID, or revision ID to download.'),
  fileName: z.string().describe('Optional file name to use for the uploaded transit file.').optional(),
}).describe('Input payload for downloading a Dropbox file into transit storage.')

export const downloadFileOutput = z.strictObject({
  fileId: z.string().describe('The unique identifier of the downloaded Dropbox file.'),
  name: z.string().describe('The name of the downloaded Dropbox file.'),
  mimeType: z.string().describe('The MIME type used for the transit upload.'),
  sizeBytes: z.int().describe('The size of the downloaded file content in bytes.').nullable(),
  contentBase64: z.string().describe('The downloaded file content encoded as base64.'),
}).describe('A Dropbox file downloaded into transit storage.')

export const uploadFileInput = z.strictObject({
  path: z.string().describe('A Dropbox path, file ID, revision ID, or namespace-relative path.'),
  text: z.string().describe('Inline UTF-8 text content to upload.').optional(),
  contentBase64: z.string().describe('Base64-encoded binary content to upload.').optional(),
  mimeType: z.string().describe('Optional MIME type override for inline text or base64 content.').optional(),
  mode: z.enum(['add', 'overwrite', 'update']).describe('How Dropbox should handle conflicts at the destination path.').optional(),
  updateRev: z.string().describe('The required file revision when mode is update.').optional(),
  autorename: z.boolean().describe('Whether Dropbox should autorename on conflict when supported by the mode.').optional(),
  clientModified: z.iso.datetime({ offset: true }).describe('Optional client-side modification timestamp in ISO 8601 format.').optional(),
  mute: z.boolean().describe('Whether the upload should avoid client-side user notifications.').optional(),
  strictConflict: z.boolean().describe('Whether Dropbox should use stricter conflict detection.').optional(),
  contentHash: z.string().describe('Optional Dropbox content hash for integrity verification.').optional(),
}).describe('Input payload for uploading a file to Dropbox.')

export const uploadFileOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A normalized Dropbox metadata wrapper.')

export const createFolderInput = z.strictObject({
  path: z.string().describe('A Dropbox path, file ID, revision ID, or namespace-relative path.'),
  autorename: z.boolean().describe('Whether Dropbox should autorename on conflict.').optional(),
}).describe('Input payload for creating a Dropbox folder.')

export const createFolderOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A normalized Dropbox metadata wrapper.')

export const moveInput = z.strictObject({
  fromPath: z.string().describe('The Dropbox source path or ID.'),
  toPath: z.string().describe('The Dropbox destination path or ID.'),
  autorename: z.boolean().describe('Whether Dropbox should autorename on conflict.').optional(),
  allowOwnershipTransfer: z.boolean().describe('Whether ownership transfer is allowed when Dropbox supports it.').optional(),
}).describe('Input payload for moving or copying Dropbox content.')

export const moveOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A normalized Dropbox metadata wrapper.')

export const copyInput = z.strictObject({
  fromPath: z.string().describe('The Dropbox source path or ID.'),
  toPath: z.string().describe('The Dropbox destination path or ID.'),
  autorename: z.boolean().describe('Whether Dropbox should autorename on conflict.').optional(),
  allowOwnershipTransfer: z.boolean().describe('Whether ownership transfer is allowed when Dropbox supports it.').optional(),
}).describe('Input payload for moving or copying Dropbox content.')

export const copyOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A normalized Dropbox metadata wrapper.')

export const deleteInput = z.strictObject({
  path: z.string().describe('The Dropbox path or ID to delete.'),
  parentRev: z.string().describe('Optional parent revision that must match when deleting a file.').optional(),
}).describe('Input payload for deleting Dropbox content.')

export const deleteOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A normalized Dropbox metadata wrapper.')

export const createSharedLinkInput = z.strictObject({
  path: z.string().describe('The Dropbox path, file ID, or revision ID to share.'),
  requestedVisibility: z.enum(['public', 'team_only', 'password']).describe('The requested visibility for the shared link.').optional(),
  audience: z.enum(['public', 'team', 'no_one']).describe('The requested audience for the shared link.').optional(),
  access: z.enum(['viewer', 'editor', 'max']).describe('The requested access level for the shared link.').optional(),
  allowDownload: z.boolean().describe('Whether the shared link should allow downloads when supported.').optional(),
  password: z.string().describe('Optional password to apply when password visibility is used.').optional(),
  expiresAt: z.iso.datetime({ offset: true }).describe('Optional shared-link expiration timestamp in ISO 8601 format.').optional(),
}).describe('Input payload for creating a Dropbox shared link.')

export const createSharedLinkOutput = z.strictObject({
  link: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A Dropbox shared-link creation result.')

export const listSharedLinksInput = z.strictObject({
  path: z.string().describe('Optional Dropbox path, file ID, or revision ID used to filter shared links.').optional(),
  cursor: z.string().describe('Optional cursor returned by a previous shared-link listing.').optional(),
  directOnly: z.boolean().describe('Whether parent-folder links should be excluded when path is provided.').optional(),
}).describe('Input payload for listing Dropbox shared links.')

export const listSharedLinksOutput = z.strictObject({
  links: z.array(z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.')).describe('The shared links returned by Dropbox.'),
  cursor: z.string().describe('The cursor for continuing the listing when Dropbox provides it.').nullable(),
  hasMore: z.boolean().describe('Whether more shared links are available.'),
}).describe('A Dropbox shared-link listing page.')

export const searchFilesInput = z.strictObject({
  query: z.string().min(1).regex(new RegExp('\\S')).describe('The Dropbox search query.'),
  path: z.string().describe('Optional folder path that limits where Dropbox searches.').optional(),
  maxResults: z.int().min(1).max(1000).describe('The maximum number of search matches to return.').optional(),
  fileStatus: z.enum(['active', 'deleted']).describe('Whether Dropbox should search active or deleted content.').optional(),
  filenameOnly: z.boolean().describe('Whether Dropbox should search only file and folder names.').optional(),
  fileCategories: z.array(z.enum(['image', 'document', 'pdf', 'spreadsheet', 'presentation', 'audio', 'video', 'folder', 'paper', 'others']).describe('A Dropbox file category.')).describe('Optional Dropbox file categories used to filter search results.').optional(),
  fileExtensions: z.array(z.string().min(1).regex(new RegExp('\\S')).describe('A file extension.')).describe('Optional file extensions used to filter search results.').optional(),
  orderBy: z.enum(['relevance', 'last_modified_time']).describe('How Dropbox should order search results.').optional(),
  includeHighlights: z.boolean().describe('Whether Dropbox should include match highlight spans when available.').optional(),
}).describe('Input payload for searching Dropbox files and folders.')

export const searchFilesOutput = z.strictObject({
  matches: z.array(z.strictObject({
    matchType: z.string().describe('The Dropbox match type tag.'),
    metadata: z.strictObject({
      tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
      name: z.string().describe('The Dropbox item name.'),
      id: z.string().describe('The Dropbox item ID when available.').nullable(),
      pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
      pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
      clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
      serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
      rev: z.string().describe('The Dropbox file revision when available.').nullable(),
      sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
      isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
      contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
      url: z.string().describe('The shared link URL when available.').nullable(),
      expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
      sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
      linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
    }).describe('A normalized Dropbox metadata or shared-link record.'),
    highlightSpans: z.array(z.looseObject({}).describe('A generic JSON object returned by Dropbox.')).describe('Dropbox highlight spans when requested and returned.').nullable(),
  }).describe('A normalized Dropbox search match.')).describe('The Dropbox search matches.'),
  cursor: z.string().describe('The cursor for continuing the search when available.').nullable(),
  hasMore: z.boolean().describe('Whether more search matches are available.'),
}).describe('A Dropbox search result page.')

export const searchFilesContinueInput = z.strictObject({
  cursor: z.string().min(1).regex(new RegExp('\\S')).describe('The cursor returned by a previous Dropbox search.'),
}).describe('Input payload for continuing a Dropbox search.')

export const searchFilesContinueOutput = z.strictObject({
  matches: z.array(z.strictObject({
    matchType: z.string().describe('The Dropbox match type tag.'),
    metadata: z.strictObject({
      tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
      name: z.string().describe('The Dropbox item name.'),
      id: z.string().describe('The Dropbox item ID when available.').nullable(),
      pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
      pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
      clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
      serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
      rev: z.string().describe('The Dropbox file revision when available.').nullable(),
      sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
      isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
      contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
      url: z.string().describe('The shared link URL when available.').nullable(),
      expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
      sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
      linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
    }).describe('A normalized Dropbox metadata or shared-link record.'),
    highlightSpans: z.array(z.looseObject({}).describe('A generic JSON object returned by Dropbox.')).describe('Dropbox highlight spans when requested and returned.').nullable(),
  }).describe('A normalized Dropbox search match.')).describe('The Dropbox search matches.'),
  cursor: z.string().describe('The cursor for continuing the search when available.').nullable(),
  hasMore: z.boolean().describe('Whether more search matches are available.'),
}).describe('A Dropbox search result page.')

export const getTemporaryLinkInput = z.strictObject({
  path: z.string().describe('The Dropbox file path or ID to create a temporary link for.'),
}).describe('Input payload for creating a Dropbox temporary file link.')

export const getTemporaryLinkOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
  link: z.string().describe('The temporary Dropbox link.'),
}).describe('A Dropbox temporary link result.')

export const saveUrlInput = z.strictObject({
  path: z.string().describe('The Dropbox destination path for the saved URL.'),
  url: z.url().describe('The publicly reachable URL Dropbox should save.'),
}).describe('Input payload for saving a URL into Dropbox.')

export const saveUrlOutput = z.strictObject({
  tag: z.string().describe('The Dropbox save_url result tag.'),
  asyncJobId: z.string().describe('The async job ID when Dropbox continues in background.').nullable(),
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.').nullable(),
  failure: z.looseObject({}).describe('Dropbox failure details when the job failed.').nullable(),
}).describe('A normalized Dropbox save_url or save_url/check_job_status result.')

export const saveUrlCheckJobStatusInput = z.strictObject({
  asyncJobId: z.string().min(1).regex(new RegExp('\\S')).describe('The Dropbox async job ID returned by save_url.'),
}).describe('Input payload for checking a Dropbox save_url job.')

export const saveUrlCheckJobStatusOutput = z.strictObject({
  tag: z.string().describe('The Dropbox save_url result tag.'),
  asyncJobId: z.string().describe('The async job ID when Dropbox continues in background.').nullable(),
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.').nullable(),
  failure: z.looseObject({}).describe('Dropbox failure details when the job failed.').nullable(),
}).describe('A normalized Dropbox save_url or save_url/check_job_status result.')

export const listRevisionsInput = z.strictObject({
  path: z.string().describe('The Dropbox file path or ID whose revisions should be listed.'),
  mode: z.enum(['path', 'id']).describe('Whether Dropbox should list revisions by path or by file ID.').optional(),
  beforeRev: z.string().describe('Optional revision used to page older revisions when mode is path.').optional(),
  limit: z.int().min(1).max(100).describe('The maximum number of revisions to return.').optional(),
}).describe('Input payload for listing Dropbox file revisions.')

export const listRevisionsOutput = z.strictObject({
  entries: z.array(z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.')).describe('The Dropbox file revision metadata entries.'),
  isDeleted: z.boolean().describe('Whether the latest file entry is deleted.'),
  serverDeleted: z.string().describe('The deletion timestamp when Dropbox returns one.').nullable(),
  hasMore: z.boolean().describe('Whether more older revisions are available.'),
}).describe('A Dropbox file revision listing.')

export const restoreInput = z.strictObject({
  path: z.string().describe('The Dropbox file path to restore.'),
  rev: z.string().min(1).regex(new RegExp('\\S')).describe('The Dropbox revision ID to restore.'),
}).describe('Input payload for restoring a Dropbox file revision.')

export const restoreOutput = z.strictObject({
  metadata: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A normalized Dropbox metadata wrapper.')

export const getSharedLinkMetadataInput = z.strictObject({
  url: z.string().min(1).regex(new RegExp('\\S')).describe('The Dropbox shared link URL.'),
  path: z.string().describe('Optional path inside the shared link when the link points to a folder.').optional(),
}).describe('Input payload for reading Dropbox shared-link metadata.')

export const getSharedLinkMetadataOutput = z.strictObject({
  link: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A Dropbox shared-link creation result.')

export const getSharedLinkFileInput = z.strictObject({
  url: z.string().min(1).regex(new RegExp('\\S')).describe('The Dropbox shared link URL.'),
  path: z.string().describe('Optional path inside the shared link when the link points to a folder.').optional(),
  fileName: z.string().describe('Optional file name to use for the uploaded transit file.').optional(),
}).describe('Input payload for downloading a Dropbox shared-link file into transit storage.')

export const getSharedLinkFileOutput = z.strictObject({
  fileId: z.string().describe('The unique identifier of the downloaded Dropbox file.'),
  name: z.string().describe('The name of the downloaded Dropbox file.'),
  mimeType: z.string().describe('The MIME type used for the transit upload.'),
  sizeBytes: z.int().describe('The size of the downloaded file content in bytes.').nullable(),
  contentBase64: z.string().describe('The downloaded file content encoded as base64.'),
}).describe('A Dropbox file downloaded into transit storage.')

export const modifySharedLinkInput = z.strictObject({
  url: z.string().min(1).regex(new RegExp('\\S')).describe('The Dropbox shared link URL to modify.'),
  requestedVisibility: z.enum(['public', 'team_only', 'password']).describe('The requested visibility for the shared link.').optional(),
  audience: z.enum(['public', 'team', 'no_one']).describe('The requested audience for the shared link.').optional(),
  access: z.enum(['viewer', 'editor', 'max']).describe('The requested access level for the shared link.').optional(),
  allowDownload: z.boolean().describe('Whether the shared link should allow downloads when supported.').optional(),
  password: z.string().describe('Optional password to apply when password visibility is used.').optional(),
  expiresAt: z.iso.datetime({ offset: true }).describe('Optional shared-link expiration timestamp in ISO 8601 format.').optional(),
  removeExpiration: z.boolean().describe('Whether Dropbox should remove the existing shared-link expiration.').optional(),
}).describe('Input payload for modifying Dropbox shared-link settings.')

export const modifySharedLinkOutput = z.strictObject({
  link: z.strictObject({
    tag: z.string().describe('The Dropbox metadata tag such as file, folder, or deleted.'),
    name: z.string().describe('The Dropbox item name.'),
    id: z.string().describe('The Dropbox item ID when available.').nullable(),
    pathDisplay: z.string().describe('The user-facing cased path when available.').nullable(),
    pathLower: z.string().describe('The lower-cased full path when available.').nullable(),
    clientModified: z.string().describe('The client-provided modification timestamp in ISO 8601 format when available.').nullable(),
    serverModified: z.string().describe('The server-side modification timestamp in ISO 8601 format when available.').nullable(),
    rev: z.string().describe('The Dropbox file revision when available.').nullable(),
    sizeBytes: z.int().describe('The file size in bytes when available.').nullable(),
    isDownloadable: z.boolean().describe('Whether the file can be downloaded directly.').nullable(),
    contentHash: z.string().describe('The Dropbox content hash when available.').nullable(),
    url: z.string().describe('The shared link URL when available.').nullable(),
    expiresAt: z.string().describe('The shared link expiration timestamp in ISO 8601 format when available.').nullable(),
    sharingInfo: z.looseObject({}).describe('A generic JSON object returned by Dropbox.').nullable(),
    linkPermissions: z.looseObject({}).describe('Shared-link permission metadata when Dropbox includes it.').nullable(),
  }).describe('A normalized Dropbox metadata or shared-link record.'),
}).describe('A Dropbox shared-link creation result.')

export const revokeSharedLinkInput = z.strictObject({
  url: z.string().min(1).regex(new RegExp('\\S')).describe('The Dropbox shared link URL to revoke.'),
}).describe('Input payload for revoking a Dropbox shared link.')

export const revokeSharedLinkOutput = z.strictObject({
  revoked: z.boolean().describe('Whether the shared link revoke call completed.'),
}).describe('A Dropbox shared-link revoke result.')

export const getTagsInput = z.strictObject({
  paths: z.array(z.string().describe('A Dropbox path, file ID, revision ID, or namespace-relative path.')).min(1).describe('Dropbox file or folder paths to inspect.'),
}).describe('Input payload for reading Dropbox tags.')

export const getTagsOutput = z.strictObject({
  pathsToTags: z.array(z.strictObject({
    path: z.string().describe('The Dropbox path whose tags were returned.'),
    tags: z.array(z.strictObject({
      tag: z.string().describe('The Dropbox tag union tag.'),
      tagText: z.string().describe('The user-generated tag text when available.').nullable(),
    }).describe('A normalized Dropbox tag.')).describe('The tags assigned to the path.'),
  }).describe('Dropbox tags attached to one path.')).describe('Tags grouped by Dropbox path.'),
}).describe('A normalized Dropbox tags response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const dropboxActions = {
  get_current_account: {
    description: 'Get basic profile information for the current Dropbox account.',
    effect: 'read',
    inputSchema: getCurrentAccountInput,
    outputSchema: z.toJSONSchema(getCurrentAccountOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_folder: {
    description: 'List files and folders inside one Dropbox folder.',
    effect: 'read',
    inputSchema: listFolderInput,
    outputSchema: z.toJSONSchema(listFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_folder_continue: {
    description: 'Continue a previous Dropbox folder listing with a cursor.',
    effect: 'read',
    inputSchema: listFolderContinueInput,
    outputSchema: z.toJSONSchema(listFolderContinueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_metadata: {
    description: 'Get Dropbox metadata for one file or folder.',
    effect: 'read',
    inputSchema: getMetadataInput,
    outputSchema: z.toJSONSchema(getMetadataOutput, { io: 'output', unrepresentable: 'any' }),
  },
  download_file: {
    description: 'Download one Dropbox file and return its content encoded as base64.',
    effect: 'read',
    inputSchema: downloadFileInput,
    outputSchema: z.toJSONSchema(downloadFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  upload_file: {
    description: 'Upload one file to Dropbox from inline text or base64 content.',
    effect: 'write',
    inputSchema: uploadFileInput,
    outputSchema: z.toJSONSchema(uploadFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_folder: {
    description: 'Create one folder in Dropbox.',
    effect: 'write',
    inputSchema: createFolderInput,
    outputSchema: z.toJSONSchema(createFolderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  move: {
    description: 'Move one file or folder to another Dropbox path.',
    effect: 'write',
    inputSchema: moveInput,
    outputSchema: z.toJSONSchema(moveOutput, { io: 'output', unrepresentable: 'any' }),
  },
  copy: {
    description: 'Copy one file or folder to another Dropbox path.',
    effect: 'write',
    inputSchema: copyInput,
    outputSchema: z.toJSONSchema(copyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete: {
    description: 'Delete one file or folder from Dropbox.',
    effect: 'write',
    inputSchema: deleteInput,
    outputSchema: z.toJSONSchema(deleteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_shared_link: {
    description: 'Create one Dropbox shared link with optional custom settings.',
    effect: 'write',
    inputSchema: createSharedLinkInput,
    outputSchema: z.toJSONSchema(createSharedLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_shared_links: {
    description: 'List Dropbox shared links for the current user or a specific path.',
    effect: 'read',
    inputSchema: listSharedLinksInput,
    outputSchema: z.toJSONSchema(listSharedLinksOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_files: {
    description: 'Search Dropbox files and folders with the official search_v2 endpoint.',
    effect: 'read',
    inputSchema: searchFilesInput,
    outputSchema: z.toJSONSchema(searchFilesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_files_continue: {
    description: 'Continue a previous Dropbox file search with a cursor.',
    effect: 'read',
    inputSchema: searchFilesContinueInput,
    outputSchema: z.toJSONSchema(searchFilesContinueOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_temporary_link: {
    description: 'Create a temporary direct-download Dropbox link for one file.',
    effect: 'read',
    inputSchema: getTemporaryLinkInput,
    outputSchema: z.toJSONSchema(getTemporaryLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  save_url: {
    description: 'Ask Dropbox to save a public URL into a Dropbox file path.',
    effect: 'write',
    inputSchema: saveUrlInput,
    outputSchema: z.toJSONSchema(saveUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  save_url_check_job_status: {
    description: 'Check the status of an asynchronous Dropbox save_url job.',
    effect: 'write',
    inputSchema: saveUrlCheckJobStatusInput,
    outputSchema: z.toJSONSchema(saveUrlCheckJobStatusOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_revisions: {
    description: 'List revisions for one Dropbox file.',
    effect: 'read',
    inputSchema: listRevisionsInput,
    outputSchema: z.toJSONSchema(listRevisionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  restore: {
    description: 'Restore one Dropbox file to a previous revision.',
    effect: 'write',
    inputSchema: restoreInput,
    outputSchema: z.toJSONSchema(restoreOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_shared_link_metadata: {
    description: 'Get metadata for a Dropbox shared link.',
    effect: 'read',
    inputSchema: getSharedLinkMetadataInput,
    outputSchema: z.toJSONSchema(getSharedLinkMetadataOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_shared_link_file: {
    description: 'Download a Dropbox shared-link file and return its content encoded as base64.',
    effect: 'read',
    inputSchema: getSharedLinkFileInput,
    outputSchema: z.toJSONSchema(getSharedLinkFileOutput, { io: 'output', unrepresentable: 'any' }),
  },
  modify_shared_link: {
    description: 'Modify settings for an existing Dropbox shared link.',
    effect: 'write',
    inputSchema: modifySharedLinkInput,
    outputSchema: z.toJSONSchema(modifySharedLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  revoke_shared_link: {
    description: 'Revoke an existing Dropbox shared link.',
    effect: 'destructive',
    inputSchema: revokeSharedLinkInput,
    outputSchema: z.toJSONSchema(revokeSharedLinkOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_tags: {
    description: 'Get user-generated Dropbox tags for one or more files or folders.',
    effect: 'read',
    inputSchema: getTagsInput,
    outputSchema: z.toJSONSchema(getTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
