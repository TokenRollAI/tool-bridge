/**
 * Google Docs —— 从 open-connector 迁移的 provider(32 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api/` 下是人工改写的业务逻辑
 * (按形状切成 batch / documents 两个模块 + 纯文本渲染 plaintext),本文件把规格表与
 * handler 表对起来(键集合不吻合会在装配期炸)。
 *
 * ## 凭证走平台托管的 OAuth2
 *
 * 端点、scope 与两个授权参数逐字对应上游 `definition.ts` 的 `auth[0]` 与 `scopes.ts`。
 * 四个 scope 分别对应这个 provider 打的三个 Google 服务:Docs 读 + Docs 写 +
 * Drive 文件级(复制/搜索/导出 PDF)+ Sheets 只读(`list_spreadsheet_charts`)。
 *
 * 两个 `authorizationParams` **必须带**:
 * - `access_type=offline` —— Google **只在**它出现时下发 refresh_token,缺了它令牌一小时
 *   后过期就再也刷不回来,用户得重新走一遍授权。
 * - `prompt=consent` —— 用户第二次授权同一个应用时 Google 默认不再下发 refresh_token
 *   (它认为你已经存过了),显式要求同意页可以保证每次都重新下发。
 *
 * `clientAuth: 'client_secret_post'` 与上游 `tokenEndpointAuthMethod` 一致(也是缺省值,
 * 写出来是为了让这份声明自解释)。
 *
 * 声明了 `oauth` 就**不能**再声明 `credentialProbe` 或 `credentialFields`(SDK 当场拒):
 * oauth 模式下 authRef 指向的 secret 固定存 clientId/clientSecret,字段表由平台定。
 * 因此上游的 `credentialValidators`(打 `/oauth2/v3/userinfo`)在这里没有落点 ——
 * 令牌可用性由平台的授权流与刷新逻辑负责。
 */

import {
  createFooter,
  createFootnote,
  createHeader,
  createNamedRange,
  createParagraphBullets,
  deleteContentRange,
  deleteFooter,
  deleteHeader,
  deleteNamedRange,
  deleteParagraphBullets,
  deleteTableColumn,
  deleteTableRow,
  insertInlineImage,
  insertPageBreak,
  insertTable,
  insertTableColumn,
  insertText,
  replaceAllText,
  replaceImage,
  unmergeTableCells,
  updateDocumentBatch,
  updateDocumentStyle,
  updateExistingDocument,
  updateTableRowStyle,
} from './api/batch'
import {
  copyDocument,
  createBlankDocument,
  createDocument,
  exportDocumentAsPdf,
  getDocumentById,
  getDocumentPlaintext,
  listSpreadsheetCharts,
  searchDocuments,
} from './api/documents'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { googledocsActions } from './schema'

export type { ProviderEnv as Env }

export function createGoogledocsPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Google Docs',
    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
      ],
      clientAuth: 'client_secret_post',
      authorizationParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
    actions: googledocsActions,
    handlers: {
      copy_document: copyDocument,
      create_document: createDocument,
      create_document2: createBlankDocument,
      create_footer: createFooter,
      create_footnote: createFootnote,
      create_header: createHeader,
      create_named_range: createNamedRange,
      create_paragraph_bullets: createParagraphBullets,
      delete_content_range: deleteContentRange,
      delete_footer: deleteFooter,
      delete_header: deleteHeader,
      delete_named_range: deleteNamedRange,
      delete_paragraph_bullets: deleteParagraphBullets,
      delete_table_column: deleteTableColumn,
      delete_table_row: deleteTableRow,
      export_document_as_pdf: exportDocumentAsPdf,
      get_document_by_id: getDocumentById,
      get_document_plaintext: getDocumentPlaintext,
      insert_inline_image: insertInlineImage,
      insert_page_break: insertPageBreak,
      insert_table_action: insertTable,
      insert_table_column: insertTableColumn,
      insert_text_action: insertText,
      list_spreadsheet_charts: listSpreadsheetCharts,
      replace_all_text: replaceAllText,
      replace_image: replaceImage,
      search_documents: searchDocuments,
      unmerge_table_cells: unmergeTableCells,
      update_document_batch: updateDocumentBatch,
      update_document_style: updateDocumentStyle,
      update_existing_document: updateExistingDocument,
      update_table_row_style: updateTableRowStyle,
    },
  })
}

export default createGoogledocsPlugin()
