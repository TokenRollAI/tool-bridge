import {
  base64urlEncode,
  type CallContext,
  encodeCallContext,
  HEADER_TB_CONTEXT,
  HEADER_TB_UPSTREAM_AUTH,
} from '@tool-bridge/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoogledocsPlugin } from '../../src/googledocs/index'
import { googledocsActions } from '../../src/googledocs/schema'

/**
 * Google Docs 迁移产物的 wire 级验收。重点钉住几个"迁移最容易迁丢"的地方:
 * oauth 声明面(端点 / 四个 scope / 两个授权参数)、文档 id 能从整条分享链接里抠出来、
 * batchUpdate 的单条请求形状与 `replies[0]` 里的 id 提取、两趟调用的 action
 * (`create_document` / `create_header`)、位置二选一(index vs endOfSegment)、
 * Drive 搜索的 `q` 拼装与单引号转义、导出 PDF 的 base64、以及 403 的两种含义之别。
 */

const PLUGIN_TOKEN = 'tbp_test'
const ENV = { PLUGIN_TOKEN }
const ACCESS_TOKEN = 'ya29.a0AfB_test'
const DOC_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
const plugin = createGoogledocsPlugin()

const CALLER: CallContext = {
  keyId: 'k1',
  owner: 'agent:tester',
  scopes: [],
  traceId: 't1',
  mountPath: 'docs/google',
  exportId: 'actions',
}

function envelope(body: unknown, opts: { auth?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'authorization': `Bearer ${PLUGIN_TOKEN}`,
    'content-type': 'application/json',
    [HEADER_TB_CONTEXT]: encodeCallContext(CALLER),
  }
  const auth = opts.auth === undefined ? ACCESS_TOKEN : opts.auth
  if (auth !== null) {
    headers[HEADER_TB_UPSTREAM_AUTH] = base64urlEncode(new TextEncoder().encode(auth))
  }
  return Promise.resolve(plugin.fetch(
    new Request('https://plugin.test/', { method: 'POST', headers, body: JSON.stringify(body) }),
    ENV as never,
  ))
}

function call(name: string, args: unknown, opts?: { auth?: string | null }): Promise<Response> {
  return envelope({ tool: 'Call', arguments: { name, args } }, opts)
}

interface Reply {
  /** 原始体;传 `null` 表示无体。 */
  body?: null | string
  payload?: unknown
  status?: number
}

/** 按顺序回应出站请求(两趟的 action 会连打两次)。 */
function mockReplies(...replies: Reply[]): ReturnType<typeof vi.fn> {
  const queue = [...replies]
  const fn = vi.fn(() => {
    const reply = queue.shift() ?? { payload: {} }
    const body = reply.body === undefined ? JSON.stringify(reply.payload ?? {}) : reply.body
    return Promise.resolve(new Response(body, {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function sent(mock: ReturnType<typeof vi.fn>, index = 0): Request {
  return (mock.mock.calls[index] as [Request])[0]
}

function sentUrl(mock: ReturnType<typeof vi.fn>, index = 0): URL {
  return new URL(sent(mock, index).url)
}

/** batchUpdate 的 body 里那一条 request。 */
async function sentRequests(mock: ReturnType<typeof vi.fn>, index = 0): Promise<unknown[]> {
  const body = (await sent(mock, index).json()) as { requests: unknown[] }
  return body.requests
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('契约面', () => {
  it('~describe 报成单个 tools/v1 export,oauth 声明与上游端点/scope/授权参数逐字一致', async () => {
    const res = await createGoogledocsPlugin().fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const described = (await res.json()) as {
      exports: Array<{
        credentialFields?: unknown
        credentialProbe?: unknown
        id: string
        oauth?: Record<string, unknown>
        profile: string
      }>
    }
    expect(described.exports).toHaveLength(1)
    const [entry] = described.exports
    expect(entry).toMatchObject({ id: 'actions', profile: 'tools/v1' })
    expect(entry?.oauth).toEqual({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      // 四个 scope 对应打到的三个服务:Docs 读 / Docs 写 / Drive 文件级 / Sheets 只读。
      scopes: [
        'https://www.googleapis.com/auth/documents.readonly',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/spreadsheets.readonly',
      ],
      clientAuth: 'client_secret_post',
      // Google 只在 access_type=offline 时下发 refresh_token;prompt=consent 保证重复授权
      // 也重新下发。少任何一个,令牌过期后就刷不回来了。
      authorizationParams: { access_type: 'offline', prompt: 'consent' },
    })
    // 声明了 oauth 的 export 不能再带这两个(SDK 侧互斥)。
    expect(entry?.credentialProbe).toBeUndefined()
    expect(entry?.credentialFields).toBeUndefined()
  })

  it('List 出全部 32 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(googledocsActions).length)
    expect(tools).toHaveLength(32)
    expect(tools.map(tool => tool.name).sort()).toEqual([...Object.keys(googledocsActions)].sort())
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('删除类 action 标成 destructive,读类标成 read(effect 是平台的确认闸门依据)', () => {
    expect(googledocsActions.delete_content_range.effect).toBe('destructive')
    expect(googledocsActions.delete_table_row.effect).toBe('destructive')
    expect(googledocsActions.get_document_plaintext.effect).toBe('read')
    expect(googledocsActions.export_document_as_pdf.effect).toBe('read')
  })
})

describe('文档 id 的抠取', () => {
  it('分享链接里的 id 被抠出来,而不是整条 URL 拼进请求路径', async () => {
    const mock = mockReplies({ payload: { documentId: DOC_ID, title: 'T' } })
    await call('get_document_by_id', { id: `https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing#gid=0` })
    expect(sentUrl(mock).pathname).toBe(`/v1/documents/${DOC_ID}`)
  })

  it('裸 id 原样用;表格链接走 spreadsheets 的模式', async () => {
    const doc = mockReplies({ payload: { documentId: DOC_ID, title: 'T' } })
    await call('get_document_by_id', { id: DOC_ID })
    expect(sentUrl(doc).pathname).toBe(`/v1/documents/${DOC_ID}`)

    vi.unstubAllGlobals()
    const sheet = mockReplies({ payload: { spreadsheetId: 'sheet-1' } })
    await call('list_spreadsheet_charts', {
      spreadsheet_id: 'https://docs.google.com/spreadsheets/d/sheet-1/edit#gid=0',
    })
    expect(sentUrl(sheet).origin).toBe('https://sheets.googleapis.com')
    expect(sentUrl(sheet).pathname).toBe('/v4/spreadsheets/sheet-1')
  })

  it('纯空白的文档 id → invalid_argument 且不打上游(schema 的 z.string() 放它过)', async () => {
    const mock = mockReplies({ payload: {} })
    const res = await call('get_document_by_id', { id: '   ' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument', message: 'id is required' })
    expect(mock).not.toHaveBeenCalled()
  })
})

describe('batchUpdate 一族', () => {
  it('单条 request 打 documents/{id}:batchUpdate,凭证走 authorization 头', async () => {
    const mock = mockReplies({ payload: { replies: [{}] } })
    await call('delete_content_range', {
      document_id: DOC_ID,
      range: { startIndex: 1, endIndex: 5, segmentId: '' },
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(new URL(request.url).origin).toBe('https://docs.googleapis.com')
    expect(new URL(request.url).pathname).toBe(`/v1/documents/${DOC_ID}:batchUpdate`)
    expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({
      requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: 5, segmentId: '' } } }],
    })
  })

  it('出参是 {documentId, replies},writeControl 只在上游回了它时才透出', async () => {
    mockReplies({ payload: { replies: [{ createNamedRange: { namedRangeId: 'nr-1' } }] } })
    const withoutControl = await call('create_named_range', {
      documentId: DOC_ID,
      name: 'intro',
      rangeStartIndex: 1,
      rangeEndIndex: 9,
    })
    await expect(withoutControl.json()).resolves.toEqual({
      content: {
        documentId: DOC_ID,
        replies: [{ createNamedRange: { namedRangeId: 'nr-1' } }],
        name: 'intro',
        namedRangeId: 'nr-1',
      },
    })

    vi.unstubAllGlobals()
    mockReplies({ payload: { replies: [], writeControl: { requiredRevisionId: 'r1' } } })
    const withControl = await call('update_document_batch', {
      document_id: DOC_ID,
      requests: [{ insertPageBreak: {} }],
      write_control: { requiredRevisionId: 'r1' },
    })
    await expect(withControl.json()).resolves.toMatchObject({
      content: { writeControl: { requiredRevisionId: 'r1' } },
    })
  })

  it('update_document_batch 把 write_control 转发上去;不给它时这个键不出现在 body 里', async () => {
    const withControl = mockReplies({ payload: { replies: [] } })
    await call('update_document_batch', {
      document_id: DOC_ID,
      requests: [{ insertPageBreak: { location: { index: 1 } } }],
      write_control: { targetRevisionId: 'r9' },
    })
    await expect(sent(withControl).json()).resolves.toEqual({
      requests: [{ insertPageBreak: { location: { index: 1 } } }],
      writeControl: { targetRevisionId: 'r9' },
    })

    vi.unstubAllGlobals()
    const bare = mockReplies({ payload: { replies: [] } })
    await call('update_document_batch', { document_id: DOC_ID, requests: [{ insertPageBreak: {} }] })
    await expect(sent(bare).json()).resolves.toEqual({ requests: [{ insertPageBreak: {} }] })
  })

  it('多条 request 的 action(删列/插列/update_existing_document)原样转发数组', async () => {
    const mock = mockReplies({ payload: { replies: [{}, {}] } })
    await call('delete_table_column', {
      document_id: DOC_ID,
      requests: [
        { deleteTableColumn: { tableCellLocation: { rowIndex: 0, columnIndex: 0 } } },
        { deleteTableColumn: { tableCellLocation: { rowIndex: 0, columnIndex: 1 } } },
      ],
    })
    expect(await sentRequests(mock)).toHaveLength(2)

    vi.unstubAllGlobals()
    const edits = mockReplies({ payload: { replies: [{}] } })
    await call('update_existing_document', {
      document_id: DOC_ID,
      editDocs: [{ insertText: { text: 'x', endOfSegmentLocation: {} } }],
    })
    await expect(sent(edits).json()).resolves.toEqual({
      requests: [{ insertText: { text: 'x', endOfSegmentLocation: {} } }],
    })
  })

  it('delete_footer / delete_header 把被删的 id 回显在出参里,tab_id 只在给了时才发', async () => {
    const mock = mockReplies({ payload: { replies: [{}] } })
    const res = await call('delete_footer', { document_id: DOC_ID, footer_id: 'kix.footer1' })
    await expect(sent(mock).json()).resolves.toEqual({
      requests: [{ deleteFooter: { footerId: 'kix.footer1' } }],
    })
    await expect(res.json()).resolves.toMatchObject({ content: { footerId: 'kix.footer1' } })

    vi.unstubAllGlobals()
    const tabbed = mockReplies({ payload: { replies: [{}] } })
    await call('delete_header', { document_id: DOC_ID, header_id: 'kix.h1', tab_id: 't.0' })
    await expect(sent(tabbed).json()).resolves.toEqual({
      requests: [{ deleteHeader: { headerId: 'kix.h1', tabId: 't.0' } }],
    })
  })

  it('create_footer / create_footnote 从 replies[0] 里挑出自己的 id', async () => {
    mockReplies({ payload: { replies: [{ createFooter: { footerId: 'kix.f9' } }] } })
    await expect((await call('create_footer', { document_id: DOC_ID, type: 'DEFAULT' })).json())
      .resolves.toMatchObject({ content: { footerId: 'kix.f9' } })

    vi.unstubAllGlobals()
    mockReplies({ payload: { replies: [{ createFootnote: { footnoteId: 'kix.fn2' } }] } })
    await expect((await call('create_footnote', { documentId: DOC_ID, endOfSegmentLocation: {} })).json())
      .resolves.toMatchObject({ content: { footnoteId: 'kix.fn2' } })
  })

  it('replies[0] 里没有那个 id 时,出参里干脆不出现这个键(而不是给 undefined)', async () => {
    mockReplies({ payload: { replies: [{}] } })
    const res = await call('create_footer', { document_id: DOC_ID, type: 'DEFAULT' })
    const body = (await res.json()) as { content: Record<string, unknown> }
    expect(Object.hasOwn(body.content, 'footerId')).toBe(false)
  })

  it('insert_inline_image 的 objectId 相反:拿不到就明确给 null(出参 schema 这么声明)', async () => {
    mockReplies({ payload: { replies: [{}] } })
    const res = await call('insert_inline_image', {
      documentId: DOC_ID,
      uri: 'https://example.com/a.png',
      location: { index: 1 },
    })
    await expect(res.json()).resolves.toMatchObject({ content: { inlineObjectId: null } })
  })

  it('create_header:建完 header 再插文本,两趟的 replies 首尾相接', async () => {
    const mock = mockReplies(
      { payload: { replies: [{ createHeader: { headerId: 'kix.h7' } }] } },
      { payload: { replies: [{ insertText: {} }] } },
    )
    const res = await call('create_header', { documentId: DOC_ID, type: 'DEFAULT', text: 'Draft' })

    expect(mock).toHaveBeenCalledTimes(2)
    await expect(sent(mock, 0).json()).resolves.toEqual({
      requests: [{ createHeader: { type: 'DEFAULT' } }],
    })
    // 第二趟把文本插到第一趟换回来的那个 segment 里。
    await expect(sent(mock, 1).json()).resolves.toEqual({
      requests: [{ insertText: { text: 'Draft', endOfSegmentLocation: { segmentId: 'kix.h7' } } }],
    })
    await expect(res.json()).resolves.toEqual({
      content: {
        documentId: DOC_ID,
        headerId: 'kix.h7',
        insertedTextLength: 5,
        replies: [{ createHeader: { headerId: 'kix.h7' } }, { insertText: {} }],
      },
    })
  })

  it('create_header:不给 text 就只做一趟', async () => {
    const mock = mockReplies({ payload: { replies: [{ createHeader: { headerId: 'kix.h7' } }] } })
    const res = await call('create_header', { documentId: DOC_ID })
    expect(mock).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toMatchObject({ content: { headerId: 'kix.h7' } })
  })

  it('insert_text_action:给了 index 用 location,不给或显式追加用 endOfSegmentLocation', async () => {
    const indexed = mockReplies({ payload: { replies: [{}] } })
    const atIndex = await call('insert_text_action', {
      document_id: DOC_ID,
      text_to_insert: 'hello',
      insertion_index: 12,
      segment_id: 'kix.s1',
    })
    await expect(sent(indexed).json()).resolves.toEqual({
      requests: [{ insertText: { text: 'hello', location: { index: 12, segmentId: 'kix.s1' } } }],
    })
    await expect(atIndex.json()).resolves.toMatchObject({
      content: { insertedTextLength: 5, mode: 'index' },
    })

    vi.unstubAllGlobals()
    const appended = mockReplies({ payload: { replies: [{}] } })
    const atEnd = await call('insert_text_action', {
      document_id: DOC_ID,
      text_to_insert: 'hello',
      insertion_index: 12,
      append_to_end: true,
    })
    // 显式要求追加时,index 让位 —— 两个位置键不能同时出现。
    await expect(sent(appended).json()).resolves.toEqual({
      requests: [{ insertText: { text: 'hello', endOfSegmentLocation: {} } }],
    })
    await expect(atEnd.json()).resolves.toMatchObject({ content: { mode: 'append' } })
  })

  it('insert_table_action:index 与 insertAtEndOfSegment 的取舍与 insert_text 一致', async () => {
    const indexed = mockReplies({ payload: { replies: [{}] } })
    await call('insert_table_action', { documentId: DOC_ID, rows: 2, columns: 3, index: 7, tabId: 't.0' })
    await expect(sent(indexed).json()).resolves.toEqual({
      requests: [{ insertTable: { rows: 2, columns: 3, location: { index: 7, tabId: 't.0' } } }],
    })

    vi.unstubAllGlobals()
    const bare = mockReplies({ payload: { replies: [{}] } })
    await call('insert_table_action', { documentId: DOC_ID, rows: 1, columns: 1 })
    await expect(sent(bare).json()).resolves.toEqual({
      requests: [{ insertTable: { rows: 1, columns: 1, endOfSegmentLocation: {} } }],
    })

    vi.unstubAllGlobals()
    // 上游忽略了这个声明了的字段(见 api/batch.ts 的注释);这里按声明处理。
    const forced = mockReplies({ payload: { replies: [{}] } })
    await call('insert_table_action', {
      documentId: DOC_ID,
      rows: 1,
      columns: 1,
      index: 5,
      insertAtEndOfSegment: true,
    })
    await expect(sent(forced).json()).resolves.toEqual({
      requests: [{ insertTable: { rows: 1, columns: 1, endOfSegmentLocation: {} } }],
    })
  })

  it('replace_all_text:matchCase 兜 false,空 tab_ids 不发 tabsCriteria,回显替换次数', async () => {
    const mock = mockReplies({ payload: { replies: [{ replaceAllText: { occurrencesChanged: 3 } }] } })
    const res = await call('replace_all_text', {
      document_id: DOC_ID,
      find_text: 'foo',
      replace_text: 'bar',
      tab_ids: [],
    })
    await expect(sent(mock).json()).resolves.toEqual({
      requests: [{
        replaceAllText: {
          containsText: { text: 'foo', matchCase: false },
          replaceText: 'bar',
        },
      }],
    })
    await expect(res.json()).resolves.toMatchObject({ content: { occurrencesChanged: 3 } })

    vi.unstubAllGlobals()
    const tabbed = mockReplies({ payload: { replies: [{}] } })
    await call('replace_all_text', {
      document_id: DOC_ID,
      find_text: 'foo',
      replace_text: 'bar',
      match_case: true,
      search_by_regex: true,
      tab_ids: ['t.0', 't.1'],
    })
    await expect(sent(tabbed).json()).resolves.toEqual({
      requests: [{
        replaceAllText: {
          containsText: { text: 'foo', matchCase: true, searchByRegex: true },
          replaceText: 'bar',
          tabsCriteria: { tabIds: ['t.0', 't.1'] },
        },
      }],
    })
  })

  it('update_document_style:不给 fields 就按样式键拼掩码,空对象退化成 *,掩码回显在出参', async () => {
    const derived = mockReplies({ payload: { replies: [{}] } })
    const res = await call('update_document_style', {
      document_id: DOC_ID,
      document_style: { marginTop: { magnitude: 36, unit: 'PT' }, pageSize: {} },
    })
    await expect(sent(derived).json()).resolves.toMatchObject({
      requests: [{ updateDocumentStyle: { fields: 'marginTop,pageSize' } }],
    })
    await expect(res.json()).resolves.toMatchObject({ content: { fields: 'marginTop,pageSize' } })

    vi.unstubAllGlobals()
    const star = mockReplies({ payload: { replies: [{}] } })
    await call('update_document_style', { document_id: DOC_ID, document_style: {} })
    await expect(sent(star).json()).resolves.toMatchObject({
      requests: [{ updateDocumentStyle: { fields: '*' } }],
    })

    vi.unstubAllGlobals()
    const explicit = mockReplies({ payload: { replies: [{}] } })
    await call('update_document_style', {
      document_id: DOC_ID,
      document_style: { marginTop: {} },
      fields: 'marginTop.magnitude',
      tab_id: 't.0',
    })
    await expect(sent(explicit).json()).resolves.toMatchObject({
      requests: [{ updateDocumentStyle: { fields: 'marginTop.magnitude', tabId: 't.0' } }],
    })
  })
})

describe('文档级 / Drive / Sheets', () => {
  it('create_document:先建文档,再把初始文本插到正文段(segmentId 是空串)', async () => {
    const mock = mockReplies(
      { payload: { documentId: DOC_ID, title: 'Notes', revisionId: 'r1' } },
      { payload: { replies: [{}] } },
    )
    const res = await call('create_document', { title: 'Notes', text: 'hello' })

    expect(sentUrl(mock, 0).pathname).toBe('/v1/documents')
    await expect(sent(mock, 0).json()).resolves.toEqual({ title: 'Notes' })
    await expect(sent(mock, 1).json()).resolves.toEqual({
      requests: [{ insertText: { text: 'hello', endOfSegmentLocation: { segmentId: '' } } }],
    })
    await expect(res.json()).resolves.toEqual({
      content: { documentId: DOC_ID, title: 'Notes', revisionId: 'r1', insertedTextLength: 5 },
    })
  })

  it('create_document:不给 text 就只建文档,insertedTextLength 回 0', async () => {
    const mock = mockReplies({ payload: { documentId: DOC_ID, title: 'Notes' } })
    const res = await call('create_document', { title: 'Notes' })
    expect(mock).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({
      content: { documentId: DOC_ID, title: 'Notes', revisionId: null, insertedTextLength: 0 },
    })
  })

  it('create_document2 只建空文档,出参是摘要三件套', async () => {
    const mock = mockReplies({ payload: { documentId: DOC_ID, title: 'Blank' } })
    const res = await call('create_document2', { title: 'Blank' })
    expect(mock).toHaveBeenCalledTimes(1)
    await expect(res.json()).resolves.toEqual({
      content: { documentId: DOC_ID, title: 'Blank', revisionId: null },
    })
  })

  it('copy_document:打 Drive 的 copy,带字段掩码与 supportsAllDrives,标题可省', async () => {
    const mock = mockReplies({
      payload: { id: 'copy-1', name: 'Copy of Notes', mimeType: 'application/vnd.google-apps.document' },
    })
    const res = await call('copy_document', { document_id: DOC_ID, title: 'Copy of Notes' })

    const url = sentUrl(mock)
    expect(url.origin).toBe('https://www.googleapis.com')
    expect(url.pathname).toBe(`/drive/v3/files/${DOC_ID}/copy`)
    expect(url.searchParams.get('supportsAllDrives')).toBe('true')
    expect(url.searchParams.get('fields')).toContain('owners(displayName,emailAddress,permissionId,photoLink)')
    await expect(sent(mock).json()).resolves.toEqual({ name: 'Copy of Notes' })
    await expect(res.json()).resolves.toEqual({
      content: {
        id: 'copy-1',
        name: 'Copy of Notes',
        mimeType: 'application/vnd.google-apps.document',
        webViewLink: null,
        createdTime: null,
        modifiedTime: null,
        driveId: null,
      },
    })

    vi.unstubAllGlobals()
    const untitled = mockReplies({ payload: { id: 'copy-2' } })
    await call('copy_document', { document_id: DOC_ID, include_shared_drives: false })
    expect(sentUrl(untitled).searchParams.get('supportsAllDrives')).toBe('false')
    await expect(sent(untitled).json()).resolves.toEqual({})
  })

  it('Drive 文件的布尔字段只在上游给了布尔时才透出,owners/parents 逐项裁剪', async () => {
    mockReplies({
      payload: {
        id: 'f1',
        name: 'Doc',
        mimeType: 'application/vnd.google-apps.document',
        parents: ['folder-1', 42],
        owners: [{ displayName: 'Sasha', emailAddress: 's@example.com', extra: 'dropped' }],
        shared: true,
        starred: 'yes',
      },
    })
    const res = await call('copy_document', { document_id: DOC_ID })
    const body = (await res.json()) as { content: Record<string, unknown> }
    expect(body.content).toMatchObject({
      parents: ['folder-1'],
      owners: [{ displayName: 'Sasha', emailAddress: 's@example.com', permissionId: null, photoLink: null }],
      shared: true,
    })
    // starred 不是布尔 → 整键丢掉,而不是塞一个 'yes' 进去。
    expect(Object.hasOwn(body.content, 'starred')).toBe(false)
    expect(Object.hasOwn(body.content, 'trashed')).toBe(false)
  })

  it('search_documents:q 固定带 Docs 类型 + 默认排除回收站,其余条件按给了什么追加', async () => {
    const mock = mockReplies({ payload: { files: [], nextPageToken: 'next' } })
    await call('search_documents', {
      query: 'quarterly',
      starred_only: true,
      shared_with_me: true,
      created_after: '2024-01-01T00:00:00Z',
      max_results: 25,
      order_by: 'modifiedTime desc',
      page_token: 'tok',
    })

    const url = sentUrl(mock)
    expect(url.pathname).toBe('/drive/v3/files')
    expect(url.searchParams.get('q')).toBe([
      'mimeType=\'application/vnd.google-apps.document\'',
      'trashed=false',
      'starred=true',
      'sharedWithMe=true',
      'createdTime > \'2024-01-01T00:00:00Z\'',
      'fullText contains \'quarterly\'',
    ].join(' and '))
    expect(url.searchParams.get('pageSize')).toBe('25')
    expect(url.searchParams.get('orderBy')).toBe('modifiedTime desc')
    expect(url.searchParams.get('pageToken')).toBe('tok')
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true')
  })

  it('search_documents:带撇号的关键词要转义,已经是 Drive 语法的原样用,pageSize 缺省 10', async () => {
    const quoted = mockReplies({ payload: { files: [] } })
    await call('search_documents', { query: 'it\'s here' })
    expect(sentUrl(quoted).searchParams.get('q')).toContain('fullText contains \'it\\\'s here\'')
    expect(sentUrl(quoted).searchParams.get('pageSize')).toBe('10')

    vi.unstubAllGlobals()
    const raw = mockReplies({ payload: { files: [] } })
    await call('search_documents', { query: 'name = \'Report\' and starred = true', include_trashed: true })
    const q = sentUrl(raw).searchParams.get('q')
    expect(q).toBe('mimeType=\'application/vnd.google-apps.document\' and name = \'Report\' and starred = true')
    // include_trashed 为真时不追加 trashed=false。
    expect(q).not.toContain('trashed=false')
  })

  it('search_documents 的出参:文件逐个裁剪,nextPageToken 缺席给 null', async () => {
    mockReplies({ payload: { files: [{ id: 'f1', name: 'A', mimeType: 'application/vnd.google-apps.document' }] } })
    const res = await call('search_documents', {})
    await expect(res.json()).resolves.toEqual({
      content: {
        documents: [{
          id: 'f1',
          name: 'A',
          mimeType: 'application/vnd.google-apps.document',
          webViewLink: null,
          createdTime: null,
          modifiedTime: null,
          driveId: null,
        }],
        nextPageToken: null,
      },
    })
  })

  it('export_document_as_pdf:走 Drive 的 export,回 base64 与字节数,文件名补 .pdf', async () => {
    const mock = mockReplies({ body: 'hi' })
    const res = await call('export_document_as_pdf', { file_id: DOC_ID, filename: 'report' })

    const url = sentUrl(mock)
    expect(url.pathname).toBe(`/drive/v3/files/${DOC_ID}/export`)
    expect(url.searchParams.get('mimeType')).toBe('application/pdf')
    await expect(res.json()).resolves.toEqual({
      content: {
        fileId: DOC_ID,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        dataBase64: 'aGk=',
        sizeBytes: 2,
      },
    })

    vi.unstubAllGlobals()
    mockReplies({ body: 'hi' })
    // 不给文件名就用 fileId;已经带 .pdf 的不重复补。
    await expect((await call('export_document_as_pdf', { file_id: DOC_ID })).json())
      .resolves.toMatchObject({ content: { filename: `${DOC_ID}.pdf` } })

    vi.unstubAllGlobals()
    mockReplies({ body: 'hi' })
    await expect((await call('export_document_as_pdf', { file_id: DOC_ID, filename: 'a.pdf' })).json())
      .resolves.toMatchObject({ content: { filename: 'a.pdf' } })
  })

  it('get_document_by_id:include_tabs_content 只在为真时进 query;出参只留 Google 给了的容器', async () => {
    const bare = mockReplies({ payload: { documentId: DOC_ID, title: 'T', body: { content: [] } } })
    const res = await call('get_document_by_id', { id: DOC_ID })
    expect([...sentUrl(bare).searchParams.keys()]).toEqual([])
    const body = (await res.json()) as { content: Record<string, unknown> }
    expect(body.content).toEqual({ documentId: DOC_ID, title: 'T', revisionId: null, body: { content: [] } })
    expect(Object.hasOwn(body.content, 'tabs')).toBe(false)

    vi.unstubAllGlobals()
    const tabs = mockReplies({ payload: { documentId: DOC_ID, title: 'T', tabs: [{ tabProperties: {} }] } })
    await call('get_document_by_id', { id: DOC_ID, include_tabs_content: true })
    expect(sentUrl(tabs).searchParams.get('includeTabsContent')).toBe('true')
  })

  it('list_spreadsheet_charts:字段掩码把响应压到图表元数据,sheetId/title 缺席则丢键', async () => {
    const mock = mockReplies({
      payload: {
        spreadsheetId: 'sheet-1',
        properties: { title: 'Q3' },
        sheets: [
          { properties: { sheetId: 0, title: 'Data' }, charts: [{ chartId: 7, spec: {} }] },
          { properties: {} },
        ],
      },
    })
    const res = await call('list_spreadsheet_charts', { spreadsheet_id: 'sheet-1' })
    expect(sentUrl(mock).searchParams.get('fields')).toContain('charts(chartId,spec,position)')
    await expect(res.json()).resolves.toEqual({
      content: {
        spreadsheetId: 'sheet-1',
        title: 'Q3',
        sheets: [
          { sheetId: 0, title: 'Data', charts: [{ chartId: 7, spec: {} }] },
          { charts: [] },
        ],
      },
    })
  })
})

describe('get_document_plaintext 的渲染', () => {
  /** 一段 textRun 段落。 */
  function paragraph(text: string): unknown {
    return { paragraph: { elements: [{ textRun: { content: text } }] } }
  }

  /** 一个单元格(structural element 容器)。 */
  function cell(text: string): unknown {
    return { content: [paragraph(text)] }
  }

  it('段落按顺序拼,表格按分隔符拼,默认渲染表格', async () => {
    mockReplies({
      payload: {
        documentId: DOC_ID,
        title: 'Doc',
        body: {
          content: [
            paragraph('Intro\n'),
            { table: { tableRows: [{ tableCells: [cell('a1'), cell('a2')] }, { tableCells: [cell('b1'), cell('b2')] }] } },
          ],
        },
      },
    })
    const res = await call('get_document_plaintext', { document_id: DOC_ID })
    await expect(res.json()).resolves.toEqual({
      content: { documentId: DOC_ID, title: 'Doc', text: 'Intro\na1\ta2\nb1\tb2' },
    })
  })

  it('自定义分隔符逐字生效(纯空白的分隔符不能被当成"没给")', async () => {
    mockReplies({
      payload: {
        documentId: DOC_ID,
        body: { content: [{ table: { tableRows: [{ tableCells: [cell('a'), cell('b')] }] } }] },
      },
    })
    const res = await call('get_document_plaintext', {
      document_id: DOC_ID,
      table_cell_delimiter: ' | ',
      table_row_delimiter: '\n---\n',
    })
    await expect(res.json()).resolves.toMatchObject({ content: { text: 'a | b' } })
  })

  it('include_tables=false 时整张表不渲染', async () => {
    mockReplies({
      payload: {
        documentId: DOC_ID,
        body: {
          content: [paragraph('Keep\n'), { table: { tableRows: [{ tableCells: [cell('drop')] }] } }],
        },
      },
    })
    const res = await call('get_document_plaintext', { document_id: DOC_ID, include_tables: false })
    await expect(res.json()).resolves.toMatchObject({ content: { text: 'Keep' } })
  })

  it('页眉/页脚/脚注默认不渲染,打开后各成一节并带片段名', async () => {
    const payload = {
      documentId: DOC_ID,
      body: { content: [paragraph('Body\n')] },
      headers: { 'kix.h1': { content: [paragraph('Top\n')] } },
      footers: { 'kix.f1': { content: [paragraph('Bottom\n')] } },
      footnotes: { 'kix.fn1': { content: [paragraph('Note\n')] } },
    }
    mockReplies({ payload })
    await expect((await call('get_document_plaintext', { document_id: DOC_ID })).json())
      .resolves.toMatchObject({ content: { text: 'Body' } })

    vi.unstubAllGlobals()
    mockReplies({ payload })
    const all = await call('get_document_plaintext', {
      document_id: DOC_ID,
      include_headers: true,
      include_footers: true,
      include_footnotes: true,
    })
    await expect(all.json()).resolves.toMatchObject({
      content: {
        text: 'Body\n\n[Headers]\n(kix.h1)\nTop\n\n[Footers]\n(kix.f1)\nBottom\n\n[Footnotes]\n(kix.fn1)\nNote',
      },
    })
  })

  it('include_tabs_content:tabs 优先且递归子 tab,空 tabs 退回渲染 body', async () => {
    mockReplies({
      payload: {
        documentId: DOC_ID,
        body: { content: [paragraph('Legacy body\n')] },
        tabs: [{
          tabProperties: { title: 'Main' },
          documentTab: { body: { content: [paragraph('Tab one\n')] } },
          childTabs: [{
            tabProperties: { title: 'Child' },
            documentTab: { body: { content: [paragraph('Nested\n')] } },
          }],
        }],
      },
    })
    const withTabs = await call('get_document_plaintext', { document_id: DOC_ID, include_tabs_content: true })
    await expect(withTabs.json()).resolves.toMatchObject({
      content: { text: '[Tab: Main]\nTab one\n\n[Tab: Child]\nNested' },
    })

    vi.unstubAllGlobals()
    mockReplies({ payload: { documentId: DOC_ID, body: { content: [paragraph('Legacy body\n')] }, tabs: [] } })
    const empty = await call('get_document_plaintext', { document_id: DOC_ID, include_tabs_content: true })
    // 老文档没有 tabs 结构:不能因此渲染成空串。
    await expect(empty.json()).resolves.toMatchObject({ content: { text: 'Legacy body' } })
  })

  it('autoText 出文本,pageBreak/columnBreak 出换行,图片与公式不出文本', async () => {
    mockReplies({
      payload: {
        documentId: DOC_ID,
        body: {
          content: [{
            paragraph: {
              elements: [
                { textRun: { content: 'Page ' } },
                { autoText: { content: '3' } },
                { pageBreak: {} },
                { inlineObjectElement: { inlineObjectId: 'img' } },
                { equation: {} },
                { textRun: { content: 'after' } },
              ],
            },
          }],
        },
      },
    })
    const res = await call('get_document_plaintext', { document_id: DOC_ID })
    await expect(res.json()).resolves.toMatchObject({ content: { text: 'Page 3\nafter' } })
  })

  it('title 缺席时给 null', async () => {
    mockReplies({ payload: { documentId: DOC_ID, body: { content: [] } } })
    await expect((await call('get_document_plaintext', { document_id: DOC_ID })).json())
      .resolves.toEqual({ content: { documentId: DOC_ID, title: null, text: '' } })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:rows 必须大于 0 → 400 且不打上游', async () => {
    const mock = mockReplies({ payload: {} })
    const res = await call('insert_table_action', { documentId: DOC_ID, rows: 0, columns: 2 })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('未知字段被 strictObject 拒(上游的 snake_case / camelCase 混用不能靠猜)', async () => {
    const mock = mockReplies({ payload: {} })
    // delete_table_row 用的是 documentId,给 document_id 会被拒。
    const res = await call('delete_table_row', { document_id: DOC_ID, tableCellLocation: {} })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('403 分两种:配额耗尽 → rate_limited(可重试),权限不足 → permission_denied', async () => {
    mockReplies({
      status: 403,
      payload: {
        error: {
          code: 403,
          message: 'Rate Limit Exceeded',
          errors: [{ reason: 'rateLimitExceeded', message: 'Rate Limit Exceeded' }],
        },
      },
    })
    const limited = await call('get_document_by_id', { id: DOC_ID })
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toMatchObject({
      code: 'rate_limited',
      retryable: true,
      message: 'Rate Limit Exceeded',
    })

    vi.unstubAllGlobals()
    mockReplies({
      status: 403,
      payload: {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          errors: [{ reason: 'forbidden' }],
        },
      },
    })
    const denied = await call('get_document_by_id', { id: DOC_ID })
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'The caller does not have permission',
    })
  })

  it('401 → permission_denied,404 → not_found,400 → invalid_argument,5xx → unavailable', async () => {
    mockReplies({ status: 401, payload: { error: { message: 'Invalid Credentials' } } })
    const unauthorized = await call('get_document_by_id', { id: DOC_ID })
    expect(unauthorized.status).toBe(401)
    await expect(unauthorized.json()).resolves.toMatchObject({
      code: 'permission_denied',
      message: 'Invalid Credentials',
    })

    vi.unstubAllGlobals()
    mockReplies({ status: 404, payload: { error: { message: 'Requested entity was not found.' } } })
    await expect((await call('get_document_by_id', { id: DOC_ID })).json())
      .resolves.toMatchObject({ code: 'not_found' })

    vi.unstubAllGlobals()
    mockReplies({ status: 400, payload: { error: { message: 'Invalid requests[0].insertText' } } })
    await expect((await call('insert_text_action', { document_id: DOC_ID, text_to_insert: 'x' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Invalid requests[0].insertText' })

    vi.unstubAllGlobals()
    mockReplies({ status: 503, payload: { error: { message: 'backend error' } } })
    await expect((await call('get_document_by_id', { id: DOC_ID })).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('错误体是 HTML 错误页时截断后当消息用,不把整页塞进 message', async () => {
    const long = `<html>${'x'.repeat(900)}</html>`
    mockReplies({ status: 502, body: long })
    const res = await call('get_document_by_id', { id: DOC_ID })
    const body = (await res.json()) as { message: string }
    expect(body.message.length).toBeLessThan(600)
    expect(body.message.endsWith('…')).toBe(true)
  })

  it('2xx 上回空体或非 JSON → unavailable(上游违约),而不是 internal 500', async () => {
    mockReplies({ body: '' })
    const empty = await call('get_document_by_id', { id: DOC_ID })
    expect(empty.status).toBe(503)
    await expect(empty.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    mockReplies({ body: 'not json' })
    await expect((await call('get_document_by_id', { id: DOC_ID })).json())
      .resolves.toMatchObject({ code: 'unavailable', message: 'Google Docs 返回了非 JSON 响应' })
  })

  it('传输层失败归一成 unavailable,而不是冒成 internal 500', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('socket hang up'))))
    const res = await call('get_document_by_id', { id: DOC_ID })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没有 access token(平台没注入)→ 报错且不打上游', async () => {
    const mock = mockReplies({ payload: {} })
    const res = await call('get_document_by_id', { id: DOC_ID }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
