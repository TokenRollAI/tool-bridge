/**
 * 文档级 / Drive / Sheets 的 8 个 action(其余 24 个走 batchUpdate,见 `./batch.ts`)。
 *
 * 迁移自 open-connector `src/providers/googledocs/executors.ts`。共用的请求层在 `./shared.ts`,
 * 那里也交代了这个 provider 的整体形状与与上游的偏离。
 *
 * 五处容易迁丢的细节:
 * - **`create_document` 是两趟**:先 `POST /documents` 建文档,再用一条 batchUpdate 把初始
 *   文本插到 body 段(`segmentId: ''` 就是"正文段",不是"没给 segment")。不给 text 时
 *   第二趟不发,`insertedTextLength` 回 0。
 * - **`search_documents` 自己拼 Drive 的 `q`**:固定带上"只要 Docs 文档",默认排除回收站,
 *   其余过滤条件按给了什么追加,最后用 ` and ` 连起来。用户给的 `query` 若看起来已经是
 *   Drive 查询语法(带 `=`/`<`/`>` 或 and/or/not)就原样用,否则包成 `fullText contains '...'`
 *   并转义单引号 —— 不转义的话一个带撇号的关键词就会让整条 q 语法错误。
 * - **导出 PDF 拿的是字节流**:Drive 的 export 端点不回 JSON,故走 `send()` 直接读
 *   `arrayBuffer`,再 base64。文件名不以 `.pdf` 结尾时补上。
 * - **`include_tabs_content` 只在为真时才发**:Docs 对 `includeTabsContent=false` 与不发
 *   处理相同,但发出去会让 URL 无谓地变化(缓存/日志噪音),上游也只在真值时发。
 * - **纯文本渲染的默认值不对称**:表格默认**渲染**,页眉/页脚/脚注/tabs 默认**不渲染**,
 *   分隔符默认 `\t` / `\n`。这些默认值是上游提示词依赖的行为,照抄。
 */

import type { z } from 'zod/v4'
import type {
  copyDocumentInput,
  createDocument2Input,
  createDocumentInput,
  exportDocumentAsPdfInput,
  getDocumentByIdInput,
  getDocumentPlaintextInput,
  listSpreadsheetChartsInput,
  searchDocumentsInput,
} from '../schema'
import {
  base64,
  compact,
  DOCS_API_BASE,
  documentDetail,
  documentSummary,
  DRIVE_API_BASE,
  DRIVE_FILE_FIELDS,
  driveFile,
  type Json,
  nestedNumber,
  nestedText,
  objectArray,
  optionalText,
  type ProviderContext,
  requestRecord,
  requireDocumentId,
  requireFileId,
  requireSpreadsheetId,
  runSingle,
  send,
  SHEETS_API_BASE,
} from './shared'
import { renderDocumentPlainText } from './plaintext'

/** 建一个新文档,返回 Docs 的原始资源。 */
async function createDocumentResource(ctx: ProviderContext, title: string): Promise<Json> {
  return requestRecord(ctx, { url: `${DOCS_API_BASE}/documents`, method: 'POST', body: { title } })
}

/** 取一份文档。`includeTabsContent` 只在为真时才发(见文件头第 4 条)。 */
async function fetchDocument(ctx: ProviderContext, documentId: string, includeTabs: boolean): Promise<Json> {
  return requestRecord(ctx, {
    url: `${DOCS_API_BASE}/documents/${documentId}`,
    query: includeTabs ? { includeTabsContent: 'true' } : undefined,
  })
}

export async function copyDocument(input: z.infer<typeof copyDocumentInput>, ctx: ProviderContext): Promise<Json> {
  const fileId = requireDocumentId(input.document_id, 'document_id')
  const payload = await requestRecord(ctx, {
    url: `${DRIVE_API_BASE}/files/${fileId}/copy`,
    method: 'POST',
    query: {
      // 缺省 true:共享云端硬盘里的文档也能复制,否则 Drive 直接说找不到文件。
      supportsAllDrives: String(input.include_shared_drives ?? true),
      fields: DRIVE_FILE_FIELDS,
    },
    // 不给标题就让 Drive 用它自己的规则("Copy of …"),故这个键可以整个不出现。
    body: compact<unknown>({ name: optionalText(input.title) }) as Json,
  })
  return driveFile(payload)
}

export async function createDocument(input: z.infer<typeof createDocumentInput>, ctx: ProviderContext): Promise<Json> {
  const document = await createDocumentResource(ctx, input.title)
  const summary = documentSummary(document)
  const text = optionalText(input.text)
  if (text === undefined) return { ...summary, insertedTextLength: 0 }

  // `segmentId: ''` 是"正文段"的写法(Docs 的约定),不是"没给"。
  await runSingle(ctx, String(summary.documentId), {
    insertText: { text, endOfSegmentLocation: { segmentId: '' } },
  })
  return { ...summary, insertedTextLength: text.length }
}

export async function createBlankDocument(
  input: z.infer<typeof createDocument2Input>,
  ctx: ProviderContext,
): Promise<Json> {
  return documentSummary(await createDocumentResource(ctx, input.title))
}

export async function exportDocumentAsPdf(
  input: z.infer<typeof exportDocumentAsPdfInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const fileId = requireFileId(input.file_id, 'file_id')
  // 这个端点回的是 PDF 字节流而不是 JSON,故不能走 requestJson。
  const response = await send(ctx, {
    url: `${DRIVE_API_BASE}/files/${fileId}/export`,
    query: { mimeType: 'application/pdf' },
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  const filename = optionalText(input.filename)
  return {
    fileId,
    filename: filename === undefined ? `${fileId}.pdf` : filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
    mimeType: 'application/pdf',
    dataBase64: base64(bytes),
    sizeBytes: bytes.byteLength,
  }
}

export async function getDocumentById(
  input: z.infer<typeof getDocumentByIdInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const documentId = requireDocumentId(input.id, 'id')
  return documentDetail(await fetchDocument(ctx, documentId, input.include_tabs_content === true))
}

export async function getDocumentPlaintext(
  input: z.infer<typeof getDocumentPlaintextInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const documentId = requireDocumentId(input.document_id, 'document_id')
  const document = await fetchDocument(ctx, documentId, input.include_tabs_content === true)
  return {
    documentId,
    title: nestedText(document, ['title']) ?? null,
    text: renderDocumentPlainText(document, {
      // 默认值的不对称是上游的(见文件头第 5 条)。
      includeTables: input.include_tables ?? true,
      includeHeaders: input.include_headers ?? false,
      includeFooters: input.include_footers ?? false,
      includeFootnotes: input.include_footnotes ?? false,
      includeTabsContent: input.include_tabs_content ?? false,
      tableCellDelimiter: optionalText(input.table_cell_delimiter) ?? '\t',
      tableRowDelimiter: optionalText(input.table_row_delimiter) ?? '\n',
    }),
  }
}

export async function listSpreadsheetCharts(
  input: z.infer<typeof listSpreadsheetChartsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const spreadsheetId = requireSpreadsheetId(input.spreadsheet_id, 'spreadsheet_id')
  const payload = await requestRecord(ctx, {
    url: `${SHEETS_API_BASE}/spreadsheets/${spreadsheetId}`,
    // 字段掩码把响应压到只有图表元数据 —— 不给掩码 Sheets 会回整张表的所有单元格。
    query: { fields: 'spreadsheetId,properties(title),sheets(properties(sheetId,title),charts(chartId,spec,position))' },
  })
  return {
    spreadsheetId,
    title: nestedText(payload, ['properties', 'title']) ?? null,
    sheets: objectArray(payload.sheets).map(sheet => compact<unknown>({
      sheetId: nestedNumber(sheet, ['properties', 'sheetId']),
      title: nestedText(sheet, ['properties', 'title']),
      charts: objectArray(sheet.charts),
    })),
  }
}

/**
 * 用户给的查询串:看起来已经是 Drive 查询语法就原样用,否则包成全文搜索。
 * 单引号必须转义 —— 一个带撇号的关键词(`it's`)会让整条 q 语法错误,Drive 回 400。
 */
function driveSearchQuery(query: string): string {
  if (/[=<>]/u.test(query) || /\b(?:and|or|not)\b/iu.test(query)) return query
  return `fullText contains '${query.replace(/'/gu, '\\\'')}'`
}

export async function searchDocuments(
  input: z.infer<typeof searchDocumentsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const includeSharedDrives = String(input.include_shared_drives ?? true)
  const parts = [
    // 这一条固定带上:这个 action 只找 Docs 文档,不找别的 Drive 文件。
    'mimeType=\'application/vnd.google-apps.document\'',
    (input.include_trashed ?? false) ? undefined : 'trashed=false',
    input.starred_only === true ? 'starred=true' : undefined,
    input.shared_with_me === true ? 'sharedWithMe=true' : undefined,
    optionalText(input.created_after) === undefined ? undefined : `createdTime > '${input.created_after}'`,
    optionalText(input.modified_after) === undefined ? undefined : `modifiedTime > '${input.modified_after}'`,
    optionalText(input.query) === undefined ? undefined : driveSearchQuery(String(input.query)),
  ].filter((part): part is string => part !== undefined)

  const payload = await requestRecord(ctx, {
    url: `${DRIVE_API_BASE}/files`,
    query: compact<string>({
      q: parts.join(' and '),
      orderBy: optionalText(input.order_by),
      pageToken: optionalText(input.page_token),
      pageSize: String(input.max_results ?? 10),
      fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
      includeItemsFromAllDrives: includeSharedDrives,
      supportsAllDrives: includeSharedDrives,
    }),
  })
  return {
    documents: objectArray(payload.files).map(file => driveFile(file)),
    nextPageToken: nestedText(payload, ['nextPageToken']) ?? null,
  }
}
