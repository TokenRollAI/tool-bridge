/**
 * 走 `documents/{id}:batchUpdate` 的 24 个 action。
 *
 * 迁移自 open-connector `src/providers/googledocs/executors.ts`。共用的请求层与批量封装在
 * `./shared.ts`,那里也交代了这个 provider 的整体形状与与上游的偏离。
 *
 * 这一族的出参统一是 `{documentId, replies, writeControl?}`,各 action 再从 `replies[0]` 里把
 * 自己关心的那个 id 挑出来。四处容易迁丢的细节:
 *
 * - **文档 id 的入参名在上游是混着的**:一半 action 用 `document_id`(snake_case)、一半用
 *   `documentId`。schema 忠实反映上游,故这里也一个个对着抄,不能统一成一个名字 ——
 *   改名会让已在用的调用方全部报"未知字段"(inputSchema 是 strictObject)。
 * - **`create_header` 是两次 batchUpdate**:先建 header 拿 `headerId`,再把 `text` 插到
 *   那个 segment 里。第二次的 replies 要**接在**第一次后面(调用方按顺序读 replies)。
 * - **`insert_text_action` / `insert_table_action` 的位置二选一**:给了 index 就用
 *   `location`,否则用 `endOfSegmentLocation`。两个键同时出现 Google 直接 400。
 * - **`update_document_style` 的 fields 掩码可以省**:省了就用 `document_style` 的顶层键名
 *   拼出来,连键都没有时退化成 `*`(全量替换)。掩码给错会静默不改,故它要回显在出参里。
 */

import type { z } from 'zod/v4'
import type {
  createFooterInput,
  createFootnoteInput,
  createHeaderInput,
  createNamedRangeInput,
  createParagraphBulletsInput,
  deleteContentRangeInput,
  deleteFooterInput,
  deleteHeaderInput,
  deleteNamedRangeInput,
  deleteParagraphBulletsInput,
  deleteTableColumnInput,
  deleteTableRowInput,
  insertInlineImageInput,
  insertPageBreakInput,
  insertTableActionInput,
  insertTableColumnInput,
  insertTextActionInput,
  replaceAllTextInput,
  replaceImageInput,
  unmergeTableCellsInput,
  updateDocumentBatchInput,
  updateDocumentStyleInput,
  updateExistingDocumentInput,
  updateTableRowStyleInput,
} from '../schema'
import {
  compact,
  type Json,
  nestedNumber,
  nestedText,
  optionalText,
  type ProviderContext,
  requireDocumentId,
  runBatch,
  runSingle,
} from './shared'

export async function createFooter(input: z.infer<typeof createFooterInput>, ctx: ProviderContext): Promise<Json> {
  const documentId = requireDocumentId(input.document_id, 'document_id')
  const output = await runSingle(ctx, documentId, {
    createFooter: compact<unknown>({
      type: input.type,
      sectionBreakLocation: input.section_break_location,
    }),
  })
  return compact<unknown>({
    ...output,
    footerId: nestedText(output.replies[0], ['createFooter', 'footerId']),
  }) as Json
}

export async function createFootnote(input: z.infer<typeof createFootnoteInput>, ctx: ProviderContext): Promise<Json> {
  const documentId = requireDocumentId(input.documentId, 'documentId')
  const output = await runSingle(ctx, documentId, {
    createFootnote: compact<unknown>({
      location: input.location,
      endOfSegmentLocation: input.endOfSegmentLocation,
    }),
  })
  return compact<unknown>({
    ...output,
    footnoteId: nestedText(output.replies[0], ['createFootnote', 'footnoteId']),
  }) as Json
}

/**
 * 建 header,可选地往里插一段初始文本。
 *
 * 插文本要用第一步换回来的 `headerId` 当 segmentId,所以只能是两次 batchUpdate ——
 * 一次调用里 Google 还不认识那个 segment。拿不到 headerId(或没给 text)就只做第一步。
 */
export async function createHeader(input: z.infer<typeof createHeaderInput>, ctx: ProviderContext): Promise<Json> {
  const documentId = requireDocumentId(input.documentId, 'documentId')
  const created = await runSingle(ctx, documentId, {
    createHeader: compact<unknown>({
      type: optionalText(input.type),
      sectionBreakLocation: input.sectionBreakLocation,
    }),
  })

  const headerId = nestedText(created.replies[0], ['createHeader', 'headerId'])
  const text = optionalText(input.text)
  if (headerId === undefined || text === undefined) {
    return compact<unknown>({ ...created, headerId }) as Json
  }

  const inserted = await runSingle(ctx, documentId, {
    insertText: { text, endOfSegmentLocation: { segmentId: headerId } },
  })
  return compact<unknown>({
    documentId,
    headerId,
    insertedTextLength: text.length,
    // 两步的 replies 首尾相接:调用方按 request 顺序读它们。
    replies: [...created.replies, ...inserted.replies],
    writeControl: inserted.writeControl,
  }) as Json
}

export async function createNamedRange(
  input: z.infer<typeof createNamedRangeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const documentId = requireDocumentId(input.documentId, 'documentId')
  const output = await runSingle(ctx, documentId, {
    createNamedRange: {
      name: input.name,
      range: compact<unknown>({
        startIndex: input.rangeStartIndex,
        endIndex: input.rangeEndIndex,
        segmentId: optionalText(input.rangeSegmentId),
      }),
    },
  })
  return compact<unknown>({
    ...output,
    name: input.name,
    namedRangeId: nestedText(output.replies[0], ['createNamedRange', 'namedRangeId']),
  }) as Json
}

export function createParagraphBullets(
  input: z.infer<typeof createParagraphBulletsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.document_id, 'document_id'), {
    createParagraphBullets: input.createParagraphBullets,
  })
}

export function deleteContentRange(
  input: z.infer<typeof deleteContentRangeInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.document_id, 'document_id'), {
    deleteContentRange: { range: input.range },
  })
}

export function deleteFooter(input: z.infer<typeof deleteFooterInput>, ctx: ProviderContext): Promise<Json> {
  return runSingle(
    ctx,
    requireDocumentId(input.document_id, 'document_id'),
    { deleteFooter: compact<unknown>({ footerId: input.footer_id, tabId: optionalText(input.tab_id) }) },
    // 上游把被删的 id 回显在出参里,方便调用方对账。
    { footerId: input.footer_id },
  )
}

export function deleteHeader(input: z.infer<typeof deleteHeaderInput>, ctx: ProviderContext): Promise<Json> {
  return runSingle(
    ctx,
    requireDocumentId(input.document_id, 'document_id'),
    { deleteHeader: compact<unknown>({ headerId: input.header_id, tabId: optionalText(input.tab_id) }) },
    { headerId: input.header_id },
  )
}

export function deleteNamedRange(input: z.infer<typeof deleteNamedRangeInput>, ctx: ProviderContext): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.document_id, 'document_id'), {
    deleteNamedRange: input.deleteNamedRange,
  })
}

export function deleteParagraphBullets(
  input: z.infer<typeof deleteParagraphBulletsInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.document_id, 'document_id'), {
    deleteParagraphBullets: compact<unknown>({ range: input.range, tabId: optionalText(input.tab_id) }),
  })
}

/** 删列走**多条** request(一次可以删多列),不是单条。 */
export function deleteTableColumn(input: z.infer<typeof deleteTableColumnInput>, ctx: ProviderContext): Promise<Json> {
  return runBatch(ctx, requireDocumentId(input.document_id, 'document_id'), input.requests)
}

export function deleteTableRow(input: z.infer<typeof deleteTableRowInput>, ctx: ProviderContext): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.documentId, 'documentId'), {
    deleteTableRow: { tableCellLocation: input.tableCellLocation },
  })
}

export async function insertInlineImage(
  input: z.infer<typeof insertInlineImageInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const documentId = requireDocumentId(input.documentId, 'documentId')
  const output = await runSingle(ctx, documentId, {
    insertInlineImage: compact<unknown>({
      uri: input.uri,
      location: input.location,
      objectSize: input.objectSize,
    }),
  })
  return {
    ...output,
    // 这个键上游明确给 null 兜底(不像 footerId 那样省掉):调用方要拿它接着改图片样式。
    inlineObjectId: nestedText(output.replies[0], ['insertInlineImage', 'objectId']) ?? null,
  }
}

export function insertPageBreak(input: z.infer<typeof insertPageBreakInput>, ctx: ProviderContext): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.documentId, 'documentId'), {
    insertPageBreak: input.insertPageBreak,
  })
}

/**
 * 插表格:位置二选一 —— 给了 `index` 就定点插,否则插到 segment 末尾。
 *
 * **与上游的有意偏离**:上游 `insertTable` 只看 `index` 在不在,声明了的
 * `insertAtEndOfSegment` 被完全忽略 —— 同时给 index 与 `insertAtEndOfSegment: true` 时它
 * 仍然定点插。这里按**声明**(inputSchema 的 description 写的是"是否插到 segment 末尾")
 * 处理,与同一个 provider 里 `insert_text_action` 的 `append_to_end` 逻辑一致:显式要求
 * 追加时就追加。上游那处是漏改而不是有意的不对称(两个 action 同期加入、语义同构)。
 */
export function insertTable(input: z.infer<typeof insertTableActionInput>, ctx: ProviderContext): Promise<Json> {
  const segmentId = optionalText(input.segmentId)
  const tabId = optionalText(input.tabId)
  const atEnd = input.insertAtEndOfSegment === true || input.index === undefined
  return runSingle(ctx, requireDocumentId(input.documentId, 'documentId'), {
    insertTable: compact<unknown>({
      rows: input.rows,
      columns: input.columns,
      location: atEnd ? undefined : compact<unknown>({ index: input.index, segmentId, tabId }),
      endOfSegmentLocation: atEnd ? compact<unknown>({ segmentId, tabId }) : undefined,
    }),
  })
}

/** 插列同样走多条 request。 */
export function insertTableColumn(input: z.infer<typeof insertTableColumnInput>, ctx: ProviderContext): Promise<Json> {
  return runBatch(ctx, requireDocumentId(input.document_id, 'document_id'), input.requests)
}

/**
 * 插文本:`append_to_end` 为真、或没给 `insertion_index` 时追加到 segment 末尾,否则定点插。
 * 出参回显 `mode` 与插入长度 —— 调用方据此算下一次插入的 index。
 */
export async function insertText(input: z.infer<typeof insertTextActionInput>, ctx: ProviderContext): Promise<Json> {
  const documentId = requireDocumentId(input.document_id, 'document_id')
  // 上游 `String(input.text_to_insert ?? '')`:不给文本就是插空串(Google 会以 400 拒),
  // 不在本地拦 —— 空插入是调用方的语义错误,报上游的原文比编一个更准。
  const text = input.text_to_insert ?? ''
  const segmentId = optionalText(input.segment_id)
  const mode = input.append_to_end === true || input.insertion_index === undefined ? 'append' : 'index'
  const output = await runSingle(ctx, documentId, {
    insertText: compact<unknown>({
      text,
      location: mode === 'index' ? compact<unknown>({ index: input.insertion_index, segmentId }) : undefined,
      endOfSegmentLocation: mode === 'append' ? compact<unknown>({ segmentId }) : undefined,
    }),
  })
  return { ...output, insertedTextLength: text.length, mode }
}

export async function replaceAllText(input: z.infer<typeof replaceAllTextInput>, ctx: ProviderContext): Promise<Json> {
  const documentId = requireDocumentId(input.document_id, 'document_id')
  const output = await runSingle(ctx, documentId, {
    replaceAllText: compact<unknown>({
      containsText: compact<unknown>({
        text: input.find_text,
        // matchCase 上游给了 false 兜底(Google 的缺省也是 false,写出来是为了让请求自解释)。
        matchCase: input.match_case ?? false,
        searchByRegex: input.search_by_regex,
      }),
      replaceText: input.replace_text,
      // 空数组不发:发过去等于"在零个 tab 里找",一个都不会替换。
      tabsCriteria: input.tab_ids !== undefined && input.tab_ids.length > 0
        ? { tabIds: input.tab_ids }
        : undefined,
    }),
  })
  return compact<unknown>({
    ...output,
    occurrencesChanged: nestedNumber(output.replies[0], ['replaceAllText', 'occurrencesChanged']),
  }) as Json
}

export function replaceImage(input: z.infer<typeof replaceImageInput>, ctx: ProviderContext): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.document_id, 'document_id'), {
    replaceImage: input.replace_image,
  })
}

export function unmergeTableCells(input: z.infer<typeof unmergeTableCellsInput>, ctx: ProviderContext): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.documentId, 'documentId'), {
    unmergeTableCells: { tableRange: input.tableRange },
  })
}

/** 原样转发 Docs 的 batchUpdate;唯一会带 `writeControl` 的 action。 */
export function updateDocumentBatch(
  input: z.infer<typeof updateDocumentBatchInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runBatch(
    ctx,
    requireDocumentId(input.document_id, 'document_id'),
    input.requests,
    input.write_control,
  )
}

export async function updateDocumentStyle(
  input: z.infer<typeof updateDocumentStyleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  const documentId = requireDocumentId(input.document_id, 'document_id')
  const documentStyle = input.document_style
  // 没给掩码就按给了哪些顶层样式键拼;连键都没有时 `*` 表示整体替换(上游同款兜底)。
  const fields = optionalText(input.fields) ?? (Object.keys(documentStyle).join(',') || '*')
  const output = await runSingle(ctx, documentId, {
    updateDocumentStyle: compact<unknown>({
      documentStyle,
      fields,
      tabId: optionalText(input.tab_id),
    }),
  })
  // 掩码回显在出参里:它决定了"哪些字段真的被改了",而 Google 不回显它。
  return { ...output, fields }
}

/** 与 `update_document_batch` 同形,只是入参键叫 `editDocs` 且不收 writeControl。 */
export function updateExistingDocument(
  input: z.infer<typeof updateExistingDocumentInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runBatch(ctx, requireDocumentId(input.document_id, 'document_id'), input.editDocs)
}

export function updateTableRowStyle(
  input: z.infer<typeof updateTableRowStyleInput>,
  ctx: ProviderContext,
): Promise<Json> {
  return runSingle(ctx, requireDocumentId(input.documentId, 'documentId'), {
    updateTableRowStyle: input.updateTableRowStyle,
  })
}
