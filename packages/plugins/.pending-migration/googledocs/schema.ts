/**
 * Google Docs 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const copyDocumentInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document to copy.'),
  title: z.string().describe('The title for the copied document.').optional(),
  include_shared_drives: z.boolean().describe('Whether to include shared drives when locating the source document.').optional(),
}).describe('The input payload for this action.')

export const copyDocumentOutput = z.looseObject({
  id: z.string().describe('The ID of the file in Google Drive.'),
  name: z.string().describe('The name of the file.'),
  mimeType: z.string().describe('The MIME type of the file.'),
  webViewLink: z.string().describe('A string value that may be null.').nullable().optional(),
  createdTime: z.string().describe('A string value that may be null.').nullable().optional(),
  modifiedTime: z.string().describe('A string value that may be null.').nullable().optional(),
  driveId: z.string().describe('A string value that may be null.').nullable().optional(),
  parents: z.array(z.string()).describe('The IDs of the parent folders that contain the file.').optional(),
  owners: z.array(z.looseObject({
    displayName: z.string().describe('A string value that may be null.').nullable().optional(),
    emailAddress: z.string().describe('A string value that may be null.').nullable().optional(),
    permissionId: z.string().describe('A string value that may be null.').nullable().optional(),
    photoLink: z.string().describe('A string value that may be null.').nullable().optional(),
  }).describe('Google Drive file owner.')).describe('The owners of the file.').optional(),
  shared: z.boolean().describe('Whether the file has been shared with others.').optional(),
  starred: z.boolean().describe('Whether the user has starred the file.').optional(),
  trashed: z.boolean().describe('Whether the file has been trashed.').optional(),
}).describe('Google Drive file metadata.')

export const createDocumentInput = z.strictObject({
  title: z.string().describe('The title of the new document.'),
  text: z.string().describe('Initial text to insert at the beginning of the document.').optional(),
}).describe('The input payload for this action.')

export const createDocumentOutput = z.looseObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  title: z.string().describe('The title of the document.'),
  revisionId: z.string().describe('A string value that may be null.').nullable(),
  insertedTextLength: z.int().describe('The number of characters inserted as initial text.'),
}).describe('Google Docs action output.')

export const createDocument2Input = z.strictObject({
  title: z.string().describe('The title of the new document.'),
}).describe('The input payload for this action.')

export const createDocument2Output = z.looseObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  title: z.string().describe('The title of the document.'),
  revisionId: z.string().describe('A string value that may be null.').nullable().optional(),
}).describe('Google Docs document summary.')

export const createFooterInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  type: z.string().describe('The type of footer to create.'),
  section_break_location: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('The input payload for this action.')

export const createFooterOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const createFootnoteInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  location: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  endOfSegmentLocation: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('The input payload for this action.')

export const createFootnoteOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const createHeaderInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  type: z.string().describe('The type of header to create.').optional(),
  text: z.string().describe('Initial text to insert into the header.').optional(),
  sectionBreakLocation: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('The input payload for this action.')

export const createHeaderOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const createNamedRangeInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  name: z.string().min(1).max(256).describe('The name of the named range.'),
  rangeStartIndex: z.int().describe('The zero-based start index of the range.'),
  rangeEndIndex: z.int().describe('The zero-based end index of the range.'),
  rangeSegmentId: z.string().describe('The ID of the segment the range belongs to.').optional(),
}).describe('The input payload for this action.')

export const createNamedRangeOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const createParagraphBulletsInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  createParagraphBullets: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const createParagraphBulletsOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const deleteContentRangeInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  range: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const deleteContentRangeOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const deleteFooterInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  footer_id: z.string().describe('The ID of the footer to delete.'),
  tab_id: z.string().describe('The ID of the tab containing the footer.').optional(),
}).describe('The input payload for this action.')

export const deleteFooterOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const deleteHeaderInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  header_id: z.string().describe('The ID of the header to delete.'),
  tab_id: z.string().describe('The ID of the tab containing the header.').optional(),
}).describe('The input payload for this action.')

export const deleteHeaderOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const deleteNamedRangeInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  deleteNamedRange: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const deleteNamedRangeOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const deleteParagraphBulletsInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  range: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
  tab_id: z.string().describe('The ID of the tab containing the range.').optional(),
}).describe('The input payload for this action.')

export const deleteParagraphBulletsOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const deleteTableColumnInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  requests: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).min(1).describe('DeleteTableColumnRequest objects.'),
}).describe('The input payload for this action.')

export const deleteTableColumnOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const deleteTableRowInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  tableCellLocation: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const deleteTableRowOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const exportDocumentAsPdfInput = z.strictObject({
  file_id: z.string().describe('The ID of the Google Docs file to export.'),
  filename: z.string().describe('The filename for the exported PDF.').optional(),
}).describe('The input payload for this action.')

export const exportDocumentAsPdfOutput = z.looseObject({
  fileId: z.string().describe('The ID of the exported file in Google Drive.'),
  filename: z.string().describe('The filename used for the exported PDF.'),
  mimeType: z.literal('application/pdf').describe('The MIME type of the exported file.'),
  dataBase64: z.string().describe('The Base64-encoded binary content of the exported PDF.'),
  sizeBytes: z.int().describe('The size of the exported PDF in bytes.'),
}).describe('Google Docs action output.')

export const getDocumentByIdInput = z.strictObject({
  id: z.string().describe('The ID of the Google Docs document to retrieve.'),
  include_tabs_content: z.boolean().describe('Whether to populate the tabs field in the response.').optional(),
}).describe('The input payload for this action.')

export const getDocumentByIdOutput = z.looseObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  title: z.string().describe('The title of the document.'),
  revisionId: z.string().describe('A string value that may be null.').nullable().optional(),
  body: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  headers: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  footers: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  footnotes: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  tabs: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.').optional(),
  documentStyle: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  namedRanges: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  inlineObjects: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
  lists: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs document detail.')

export const getDocumentPlaintextInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  include_tables: z.boolean().describe('Whether to include table content.').optional(),
  include_footers: z.boolean().describe('Whether to include footer content.').optional(),
  include_headers: z.boolean().describe('Whether to include header content.').optional(),
  include_footnotes: z.boolean().describe('Whether to include footnote content.').optional(),
  include_tabs_content: z.boolean().describe('Whether to include content from all tabs.').optional(),
  table_row_delimiter: z.string().describe('The delimiter to insert between table rows.').optional(),
  table_cell_delimiter: z.string().describe('The delimiter to insert between table cells.').optional(),
}).describe('The input payload for this action.')

export const getDocumentPlaintextOutput = z.looseObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  title: z.string().describe('A string value that may be null.').nullable(),
  text: z.string().describe('The plain-text rendering of the document content.'),
}).describe('Google Docs action output.')

export const insertInlineImageInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  uri: z.url().describe('The publicly accessible URI of the image to insert.'),
  location: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
  objectSize: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('The input payload for this action.')

export const insertInlineImageOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const insertPageBreakInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  insertPageBreak: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const insertPageBreakOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const insertTableActionInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  rows: z.int().gt(0).describe('The number of rows in the table to insert.'),
  columns: z.int().gt(0).describe('The number of columns in the table to insert.'),
  index: z.int().describe('The zero-based index at which to insert the table.').optional(),
  segmentId: z.string().describe('The segment ID.').optional(),
  tabId: z.string().describe('The tab ID.').optional(),
  insertAtEndOfSegment: z.boolean().describe('Whether to insert at the end of the segment.').optional(),
}).describe('The input payload for this action.')

export const insertTableActionOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const insertTableColumnInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  requests: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).min(1).describe('InsertTableColumnRequest objects.'),
}).describe('The input payload for this action.')

export const insertTableColumnOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const insertTextActionInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  text_to_insert: z.string().describe('The text to insert.').optional(),
  append_to_end: z.boolean().describe('Whether to append the text to the end.').optional(),
  insertion_index: z.int().describe('The zero-based index at which to insert the text.').optional(),
  segment_id: z.string().describe('The segment ID.').optional(),
}).describe('The input payload for this action.')

export const insertTextActionOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const listSpreadsheetChartsInput = z.strictObject({
  spreadsheet_id: z.string().describe('The ID of the Google Sheets spreadsheet.'),
}).describe('The input payload for this action.')

export const listSpreadsheetChartsOutput = z.looseObject({
  spreadsheetId: z.string().describe('The ID of the Google Sheets spreadsheet.'),
  title: z.string().describe('A string value that may be null.').nullable(),
  sheets: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('The sheets in the spreadsheet, each with their chart metadata.'),
}).describe('Google Docs action output.')

export const replaceAllTextInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  find_text: z.string().describe('The text or pattern to search for.'),
  replace_text: z.string().describe('The replacement text.'),
  match_case: z.boolean().describe('Whether the search should be case-sensitive.').optional(),
  search_by_regex: z.boolean().describe('Whether to treat find_text as a regular expression.').optional(),
  tab_ids: z.array(z.string()).describe('The IDs of specific tabs to search.').optional(),
}).describe('The input payload for this action.')

export const replaceAllTextOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const replaceImageInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  replace_image: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const replaceImageOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const searchDocumentsInput = z.strictObject({
  query: z.string().describe('A Google Drive query string or full-text search string.').optional(),
  order_by: z.string().describe('A comma-separated list of fields to sort results by.').optional(),
  page_token: z.string().describe('A page token from a previous search response.').optional(),
  max_results: z.int().min(1).max(100).describe('The maximum number of files to return.').optional(),
  starred_only: z.boolean().describe('Whether to return only starred files.').optional(),
  created_after: z.iso.datetime({ offset: true }).describe('Only files created after this time are returned.').optional(),
  modified_after: z.iso.datetime({ offset: true }).describe('Only files modified after this time are returned.').optional(),
  shared_with_me: z.boolean().describe('Whether to return only files shared directly with the user.').optional(),
  include_trashed: z.boolean().describe('Whether to include trashed files.').optional(),
  include_shared_drives: z.boolean().describe('Whether to include files from shared drives.').optional(),
}).describe('The input payload for this action.')

export const searchDocumentsOutput = z.looseObject({
  documents: z.array(z.looseObject({
    id: z.string().describe('The ID of the file in Google Drive.'),
    name: z.string().describe('The name of the file.'),
    mimeType: z.string().describe('The MIME type of the file.'),
    webViewLink: z.string().describe('A string value that may be null.').nullable().optional(),
    createdTime: z.string().describe('A string value that may be null.').nullable().optional(),
    modifiedTime: z.string().describe('A string value that may be null.').nullable().optional(),
    driveId: z.string().describe('A string value that may be null.').nullable().optional(),
    parents: z.array(z.string()).describe('The IDs of the parent folders that contain the file.').optional(),
    owners: z.array(z.looseObject({
      displayName: z.string().describe('A string value that may be null.').nullable().optional(),
      emailAddress: z.string().describe('A string value that may be null.').nullable().optional(),
      permissionId: z.string().describe('A string value that may be null.').nullable().optional(),
      photoLink: z.string().describe('A string value that may be null.').nullable().optional(),
    }).describe('Google Drive file owner.')).describe('The owners of the file.').optional(),
    shared: z.boolean().describe('Whether the file has been shared with others.').optional(),
    starred: z.boolean().describe('Whether the user has starred the file.').optional(),
    trashed: z.boolean().describe('Whether the file has been trashed.').optional(),
  }).describe('Google Drive file metadata.')).describe('The list of matching Google Docs files.'),
  nextPageToken: z.string().describe('A string value that may be null.').nullable(),
}).describe('Google Docs action output.')

export const unmergeTableCellsInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  tableRange: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const unmergeTableCellsOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const updateDocumentBatchInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  requests: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).min(1).describe('Docs API Request objects.'),
  write_control: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('The input payload for this action.')

export const updateDocumentBatchOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const updateDocumentStyleInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  document_style: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
  fields: z.string().describe('A field mask specifying which style properties to update.').optional(),
  tab_id: z.string().describe('The ID of the tab whose document style should be updated.').optional(),
}).describe('The input payload for this action.')

export const updateDocumentStyleOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const updateExistingDocumentInput = z.strictObject({
  document_id: z.string().describe('The ID of the Google Docs document.'),
  editDocs: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).min(1).describe('Docs API Request objects describing the edits.'),
}).describe('The input payload for this action.')

export const updateExistingDocumentOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

export const updateTableRowStyleInput = z.strictObject({
  documentId: z.string().describe('The ID of the Google Docs document.'),
  updateTableRowStyle: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.'),
}).describe('The input payload for this action.')

export const updateTableRowStyleOutput = z.looseObject({
  documentId: z.string().describe('The ID of the document that was updated.'),
  replies: z.array(z.looseObject({}).describe('A JSON-like object with arbitrary string keys.')).describe('An array of JSON-like objects.'),
  writeControl: z.looseObject({}).describe('A JSON-like object with arbitrary string keys.').optional(),
}).describe('Google Docs batch update result.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const googledocsActions = {
  copy_document: {
    description: 'Copy an existing Google Docs document through Google Drive.',
    effect: 'write',
    inputSchema: copyDocumentInput,
    outputSchema: z.toJSONSchema(copyDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_document: {
    description: 'Create a Google Docs document and optionally insert initial text at the beginning.',
    effect: 'write',
    inputSchema: createDocumentInput,
    outputSchema: z.toJSONSchema(createDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_document2: {
    description: 'Create a blank Google Docs document.',
    effect: 'write',
    inputSchema: createDocument2Input,
    outputSchema: z.toJSONSchema(createDocument2Output, { io: 'output', unrepresentable: 'any' }),
  },
  create_footer: {
    description: 'Create a footer in a Google Docs document.',
    effect: 'write',
    inputSchema: createFooterInput,
    outputSchema: z.toJSONSchema(createFooterOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_footnote: {
    description: 'Create a footnote in a Google Docs document.',
    effect: 'write',
    inputSchema: createFootnoteInput,
    outputSchema: z.toJSONSchema(createFootnoteOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_header: {
    description: 'Create a header in a Google Docs document and optionally insert initial text.',
    effect: 'write',
    inputSchema: createHeaderInput,
    outputSchema: z.toJSONSchema(createHeaderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_named_range: {
    description: 'Create a named range over a specific span in a Google Docs document.',
    effect: 'write',
    inputSchema: createNamedRangeInput,
    outputSchema: z.toJSONSchema(createNamedRangeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_paragraph_bullets: {
    description: 'Add bullets to paragraphs within a specified range in a Google Docs document.',
    effect: 'write',
    inputSchema: createParagraphBulletsInput,
    outputSchema: z.toJSONSchema(createParagraphBulletsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_content_range: {
    description: 'Delete a content range from a Google Docs document.',
    effect: 'destructive',
    inputSchema: deleteContentRangeInput,
    outputSchema: z.toJSONSchema(deleteContentRangeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_footer: {
    description: 'Delete a footer from a Google Docs document.',
    effect: 'destructive',
    inputSchema: deleteFooterInput,
    outputSchema: z.toJSONSchema(deleteFooterOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_header: {
    description: 'Delete a header from a Google Docs document.',
    effect: 'destructive',
    inputSchema: deleteHeaderInput,
    outputSchema: z.toJSONSchema(deleteHeaderOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_named_range: {
    description: 'Delete a named range from a Google Docs document.',
    effect: 'destructive',
    inputSchema: deleteNamedRangeInput,
    outputSchema: z.toJSONSchema(deleteNamedRangeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_paragraph_bullets: {
    description: 'Remove bullets from paragraphs within a specified range in a Google Docs document.',
    effect: 'destructive',
    inputSchema: deleteParagraphBulletsInput,
    outputSchema: z.toJSONSchema(deleteParagraphBulletsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_table_column: {
    description: 'Delete one or more table columns from a Google Docs document.',
    effect: 'destructive',
    inputSchema: deleteTableColumnInput,
    outputSchema: z.toJSONSchema(deleteTableColumnOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_table_row: {
    description: 'Delete a table row from a Google Docs document.',
    effect: 'destructive',
    inputSchema: deleteTableRowInput,
    outputSchema: z.toJSONSchema(deleteTableRowOutput, { io: 'output', unrepresentable: 'any' }),
  },
  export_document_as_pdf: {
    description: 'Export a Google Docs file as a PDF through Google Drive.',
    effect: 'read',
    inputSchema: exportDocumentAsPdfInput,
    outputSchema: z.toJSONSchema(exportDocumentAsPdfOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_document_by_id: {
    description: 'Retrieve a Google Docs document by ID.',
    effect: 'read',
    inputSchema: getDocumentByIdInput,
    outputSchema: z.toJSONSchema(getDocumentByIdOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_document_plaintext: {
    description: 'Retrieve a Google Docs document and render it as best-effort plain text.',
    effect: 'read',
    inputSchema: getDocumentPlaintextInput,
    outputSchema: z.toJSONSchema(getDocumentPlaintextOutput, { io: 'output', unrepresentable: 'any' }),
  },
  insert_inline_image: {
    description: 'Insert an inline image from a URI at a specified location.',
    effect: 'write',
    inputSchema: insertInlineImageInput,
    outputSchema: z.toJSONSchema(insertInlineImageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  insert_page_break: {
    description: 'Insert a page break at a specified location.',
    effect: 'write',
    inputSchema: insertPageBreakInput,
    outputSchema: z.toJSONSchema(insertPageBreakOutput, { io: 'output', unrepresentable: 'any' }),
  },
  insert_table_action: {
    description: 'Insert a table at a specific index or at the end of a segment.',
    effect: 'write',
    inputSchema: insertTableActionInput,
    outputSchema: z.toJSONSchema(insertTableActionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  insert_table_column: {
    description: 'Insert one or more table columns at a specified location.',
    effect: 'write',
    inputSchema: insertTableColumnInput,
    outputSchema: z.toJSONSchema(insertTableColumnOutput, { io: 'output', unrepresentable: 'any' }),
  },
  insert_text_action: {
    description: 'Insert text at a specific index or append it to the end.',
    effect: 'write',
    inputSchema: insertTextActionInput,
    outputSchema: z.toJSONSchema(insertTextActionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_spreadsheet_charts: {
    description: 'List chart metadata from a Google Sheets spreadsheet.',
    effect: 'read',
    inputSchema: listSpreadsheetChartsInput,
    outputSchema: z.toJSONSchema(listSpreadsheetChartsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  replace_all_text: {
    description: 'Replace all matching text in a Google Docs document.',
    effect: 'write',
    inputSchema: replaceAllTextInput,
    outputSchema: z.toJSONSchema(replaceAllTextOutput, { io: 'output', unrepresentable: 'any' }),
  },
  replace_image: {
    description: 'Replace an existing image in a Google Docs document with a new image from a URI.',
    effect: 'write',
    inputSchema: replaceImageInput,
    outputSchema: z.toJSONSchema(replaceImageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search_documents: {
    description: 'Search Google Docs files with Google Drive filters.',
    effect: 'read',
    inputSchema: searchDocumentsInput,
    outputSchema: z.toJSONSchema(searchDocumentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  unmerge_table_cells: {
    description: 'Unmerge previously merged table cells in a Google Docs document.',
    effect: 'write',
    inputSchema: unmergeTableCellsInput,
    outputSchema: z.toJSONSchema(unmergeTableCellsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_document_batch: {
    description: 'Apply raw Docs batchUpdate requests to a Google Docs document.',
    effect: 'write',
    inputSchema: updateDocumentBatchInput,
    outputSchema: z.toJSONSchema(updateDocumentBatchOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_document_style: {
    description: 'Update global document style settings.',
    effect: 'write',
    inputSchema: updateDocumentStyleInput,
    outputSchema: z.toJSONSchema(updateDocumentStyleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_existing_document: {
    description: 'Apply one or more programmatic edits to an existing Google Docs document.',
    effect: 'write',
    inputSchema: updateExistingDocumentInput,
    outputSchema: z.toJSONSchema(updateExistingDocumentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_table_row_style: {
    description: 'Update the style of a table row in a Google Docs document.',
    effect: 'write',
    inputSchema: updateTableRowStyleInput,
    outputSchema: z.toJSONSchema(updateTableRowStyleOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
