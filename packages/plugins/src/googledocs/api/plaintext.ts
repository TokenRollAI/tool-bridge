/**
 * `get_document_plaintext` 的渲染器:把 Docs 的结构化文档尽力压成纯文本。
 *
 * 逐条迁移自 open-connector `src/providers/googledocs/executors.ts` 的
 * `renderDocumentPlainText` 一族。这段逻辑没有"正确答案",只有**与上游一致**才不会让
 * 已经在用它的 agent 提示词失效,故这里连拼接细节都照抄:
 *
 * - 段落文本来自 `textRun.content` 与 `autoText.content`;`pageBreak` / `columnBreak` 渲染成
 *   一个换行。别的元素(inlineObjectElement、footnoteReference、equation…)**不产出文本**
 *   —— 上游有意只取文字,图片与公式在纯文本里没有位置。
 * - `tableOfContents` 递归展开(它自己也是一串 structural element)。
 * - 表格按 `tableCellDelimiter` / `tableRowDelimiter` 拼;单元格内容先递归渲染再 `trim()`。
 *   渲染完的整张表后面补一个 `\n`。
 * - `includeTabsContent` 为真时**优先**渲染 tabs;tabs 渲染结果为空才退回渲染 `body`
 *   (老文档没有 tabs 结构)。tab 有标题就加一行 `[Tab: <title>]` 前缀,子 tab 递归。
 * - headers / footers / footnotes 各自成节,节内每个片段以 `(<segmentId>)` 开头,
 *   节与节之间空一行,整体前缀 `[Headers]` / `[Footers]` / `[Footnotes]`。
 */

import { type Json, record } from './shared'

export interface RenderOptions {
  includeFooters: boolean
  includeFootnotes: boolean
  includeHeaders: boolean
  includeTables: boolean
  includeTabsContent: boolean
  tableCellDelimiter: string
  tableRowDelimiter: string
}

/** 取容器的 `content` 数组(上游 `asContentArray`)。 */
function contentArray(container: unknown): Json[] {
  const fields = record(container)
  if (fields === undefined || !Array.isArray(fields.content)) return []
  return fields.content.flatMap((item) => {
    const element = record(item)
    return element === undefined ? [] : [element]
  })
}

function objectArray(value: unknown): Json[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const element = record(item)
    return element === undefined ? [] : [element]
  })
}

function contentText(value: unknown): string {
  const content = record(value)?.content
  return typeof content === 'string' ? content : ''
}

function renderParagraph(paragraph: Json): string {
  return objectArray(paragraph.elements).map((element) => {
    if (element.textRun !== undefined) return contentText(element.textRun)
    if (element.autoText !== undefined) return contentText(element.autoText)
    // 分页/分栏在纯文本里就是一个换行。
    if (element.pageBreak !== undefined || element.columnBreak !== undefined) return '\n'
    return ''
  }).join('')
}

/**
 * 结构元素序列 → 文本。
 *
 * 表格那一支内联在这里而不是单独一个 `renderTable`:单元格内容又是一串结构元素,拆成两个
 * 函数就成了互相递归,而 lint 不允许在定义前引用。逻辑与上游 `renderStructuralElements` /
 * `renderTable` 两个函数逐字一致(只是排布不同),靠本函数的**自递归**渲染单元格。
 */
function renderStructuralElements(elements: Json[], options: RenderOptions): string {
  let output = ''
  for (const element of elements) {
    if (element.paragraph !== undefined) {
      output += renderParagraph(record(element.paragraph) ?? {})
      continue
    }
    if (element.table !== undefined && options.includeTables) {
      const table = objectArray(record(element.table)?.tableRows)
        .map(row => objectArray(row.tableCells)
          .map(cell => renderStructuralElements(contentArray(cell), options).trim())
          .join(options.tableCellDelimiter))
        .join(options.tableRowDelimiter)
      // 整张表后面补一个换行(上游如此);空表不产出任何东西。
      if (table !== '') output += `${table}\n`
      continue
    }
    if (element.tableOfContents !== undefined) {
      output += renderStructuralElements(contentArray(element.tableOfContents), options)
    }
  }
  return output
}

function renderTabRecursive(tab: Json, options: RenderOptions): string[] {
  const outputs: string[] = []
  const documentTab = record(tab.documentTab)
  const title = typeof record(tab.tabProperties)?.title === 'string'
    ? String(record(tab.tabProperties)?.title)
    : ''
  const body = documentTab === undefined
    ? ''
    : renderStructuralElements(contentArray(documentTab.body), options).trim()
  if (body !== '') outputs.push(title === '' ? body : `[Tab: ${title}]\n${body}`)
  for (const child of objectArray(tab.childTabs)) outputs.push(...renderTabRecursive(child, options))
  return outputs
}

function renderTabs(tabs: unknown, options: RenderOptions): string {
  return objectArray(tabs)
    .flatMap(tab => renderTabRecursive(tab, options))
    .filter(value => value.trim() !== '')
    .join('\n\n')
}

/** headers / footers 的形状是 `{segmentId: {content: [...]}}`,片段名要带出来。 */
function renderNamedSegments(segments: Json, options: RenderOptions): string {
  return Object.entries(segments)
    .map(([segmentId, segment]) => {
      const text = renderStructuralElements(contentArray(segment), options).trim()
      return text === '' ? '' : `(${segmentId})\n${text}`
    })
    .filter(value => value !== '')
    .join('\n\n')
}

export function renderDocumentPlainText(document: Json, options: RenderOptions): string {
  const sections: string[] = []

  // tabs 优先,但空 tabs(老文档)要退回 body —— 否则整个文档渲染成空串。
  const bodyText = options.includeTabsContent
    ? renderTabs(document.tabs, options) || renderStructuralElements(contentArray(document.body), options)
    : renderStructuralElements(contentArray(document.body), options)
  if (bodyText.trim() !== '') sections.push(bodyText.trimEnd())

  const headers = record(document.headers)
  if (options.includeHeaders && headers !== undefined) {
    const text = renderNamedSegments(headers, options)
    if (text !== '') sections.push(`[Headers]\n${text}`)
  }
  const footers = record(document.footers)
  if (options.includeFooters && footers !== undefined) {
    const text = renderNamedSegments(footers, options)
    if (text !== '') sections.push(`[Footers]\n${text}`)
  }
  const footnotes = record(document.footnotes)
  if (options.includeFootnotes && footnotes !== undefined) {
    // 脚注与 headers/footers 同形状,上游也是同一段渲染。
    const text = renderNamedSegments(footnotes, options)
    if (text !== '') sections.push(`[Footnotes]\n${text}`)
  }

  return sections.join('\n\n').trim()
}
