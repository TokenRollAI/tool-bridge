import { describe, expect, it, vi } from 'vitest'
import { createProviderHarness } from '../support/providerHarness'
import { createDropboxPlugin } from '../../src/dropbox/index'
import { dropboxActions } from '../../src/dropbox/schema'

/**
 * Dropbox 迁移产物的 wire 级验收。重点钉住几处"迁移最容易迁丢"的地方:
 * OAuth 声明面(尤其 `token_access_type=offline`)、两个 host 的分工、内容面参数走
 * `Dropbox-API-Arg` 头、`get_current_account` 不能带 content-type、以及 Dropbox 把端点特有
 * 错误压在 409 上时靠 `.tag` 判别语义。
 */

/** 平台换来并按需刷新的 access token —— 插件侧和 api key 走同一个通道。 */
const ACCESS_TOKEN = 'sl.dropbox-access-token'
const plugin = createDropboxPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockDropbox,
  env: ENV,
  stubFetch,
} = createProviderHarness({
  mountPath: 'storage/dropbox',
  plugin,
  upstreamAuth: ACCESS_TOKEN,
})

/** 内容面的下载响应:元数据在 dropbox-api-result 头,字节在 body。 */
function mockDownload(
  body: BodyInit | null,
  metadata: unknown,
  opts: { contentType?: string } = {},
): ReturnType<typeof vi.fn> {
  const headers: Record<string, string> = { 'dropbox-api-result': JSON.stringify(metadata) }
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType
  return stubFetch(() => Promise.resolve(new Response(body, { status: 200, headers })))
}

/** 一个满足出参契约的最小文件元数据。 */
const FILE = { '.tag': 'file', 'name': 'a.txt', 'id': 'id:1', 'rev': '01', 'size': 3 }

describe('契约面', () => {
  it('List 出全部 24 个 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(dropboxActions).length)
    expect(tools).toHaveLength(24)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })

  it('~describe 报出的 export 带 oauth 字段,端点与 scope 与上游一致', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    await expect(res.json()).resolves.toEqual({
      protocolVersion: 'plugin/v2',
      exports: [{
        id: 'actions',
        profile: 'tools/v1',
        description: 'Dropbox',
        oauth: {
          authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
          tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
          scopes: [
            'account_info.read',
            'files.metadata.read',
            'files.content.read',
            'files.content.write',
            'sharing.read',
            'sharing.write',
          ],
          clientAuth: 'client_secret_post',
          authorizationParams: { token_access_type: 'offline' },
        },
      }],
    })
  })

  it('token_access_type=offline 必须在声明里 —— 少了它 Dropbox 不发 refresh_token', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ oauth?: { authorizationParams?: Record<string, string> } }>
    }
    expect(body.exports[0]?.oauth?.authorizationParams?.token_access_type).toBe('offline')
  })

  it('声明了 oauth 的 export 不带 credentialProbe / credentialFields(与 oauth 互斥)', async () => {
    const res = await plugin.fetch(new Request('https://plugin.test/~describe'), ENV as never)
    const body = (await res.json()) as {
      exports: Array<{ credentialFields?: unknown, credentialProbe?: unknown }>
    }
    expect(body.exports[0]?.credentialProbe).toBeUndefined()
    expect(body.exports[0]?.credentialFields).toBeUndefined()
  })

  /**
   * 钉住 effect 的现状,顺带把一处**待校正**记下来:`delete` 的 effect 是 `write`,
   * 但它真的会删文件。生成器按 action 名**前缀**播种 effect,而这个 action 就叫 `delete`、
   * 没有前缀可认,于是落到了"其余 write"。改它要动生成物 `schema.ts` 并登记
   * `handwritten.json`,超出本次迁移的范围 —— 此处先用测试把现状钉住,免得它被当成
   * "已经是 destructive 了"。
   */
  it('effect 的现状:revoke_shared_link 是 destructive,delete 仍被播种成 write(待校正)', () => {
    expect(dropboxActions.revoke_shared_link.effect).toBe('destructive')
    expect(dropboxActions.delete.effect).toBe('write')
  })
})

describe('两个 host 与请求拼装', () => {
  it('RPC 面打 api.dropboxapi.com/2,POST + JSON body,凭证是 Bearer access token', async () => {
    const mock = mockDropbox(200, { entries: [], cursor: 'c1', has_more: false })
    await call('list_folder', { path: '/docs', recursive: true, limit: 100 })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.dropboxapi.com/2/files/list_folder')
    expect(request.headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(request.headers.get('content-type')).toBe('application/json')
    await expect(request.json()).resolves.toEqual({ path: '/docs', recursive: true, limit: 100 })
  })

  it('get_current_account 是不带 body 的 POST,因此也不带 content-type(带了 Dropbox 会拒)', async () => {
    const mock = mockDropbox(200, { account_id: 'dbid:1', name: { display_name: 'Ada' } })
    await call('get_current_account', {})

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.dropboxapi.com/2/users/get_current_account')
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('省略 path 时列根目录发空串(Dropbox 的根不是 "/")', async () => {
    const mock = mockDropbox(200, { entries: [], cursor: 'c', has_more: false })
    await call('list_folder', {})
    await expect(sent(mock).json()).resolves.toEqual({ path: '' })
  })

  it('内容面打 content.dropboxapi.com/2,参数走 Dropbox-API-Arg 头而不是 body', async () => {
    const mock = mockDownload('abc', FILE, { contentType: 'text/plain' })
    await call('download_file', { path: '/a.txt' })

    const request = sent(mock)
    expect(request.url).toBe('https://content.dropboxapi.com/2/files/download')
    expect(request.method).toBe('POST')
    expect(request.headers.get('Dropbox-API-Arg')).toBe(JSON.stringify({ path: '/a.txt' }))
    expect(request.headers.get('content-type')).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('upload_file:字节进 body,参数进 Dropbox-API-Arg,content-type 用 mimeType', async () => {
    const mock = mockDropbox(200, FILE)
    await call('upload_file', {
      path: '/a.txt',
      text: 'hey',
      mimeType: 'text/plain',
      mode: 'overwrite',
      autorename: false,
    })

    const request = sent(mock)
    expect(request.url).toBe('https://content.dropboxapi.com/2/files/upload')
    expect(request.headers.get('content-type')).toBe('text/plain')
    expect(JSON.parse(request.headers.get('Dropbox-API-Arg') ?? '{}')).toEqual({
      path: '/a.txt',
      mode: 'overwrite',
      autorename: false,
    })
    expect(await request.text()).toBe('hey')
  })

  it('upload_file 的 contentBase64 被解成原始字节(不是把 base64 串本身传上去)', async () => {
    const mock = mockDropbox(200, FILE)
    // 'hi' 的 base64。
    await call('upload_file', { path: '/a.bin', contentBase64: 'aGk=' })
    expect(await sent(mock).text()).toBe('hi')
    expect(sent(mock).headers.get('content-type')).toBe('application/octet-stream')
  })

  it('mode \'update\' 拼成 {\'.tag\':\'update\', update: rev}', async () => {
    const mock = mockDropbox(200, FILE)
    await call('upload_file', { path: '/a.txt', text: 'x', mode: 'update', updateRev: '0123' })
    expect(JSON.parse(sent(mock).headers.get('Dropbox-API-Arg') ?? '{}')).toMatchObject({
      mode: { '.tag': 'update', 'update': '0123' },
    })
  })

  it('必填字段发出去之前去空白(Dropbox 不替你 trim,带空格的路径就是另一个路径)', async () => {
    const mock = mockDropbox(200, FILE)
    await call('get_metadata', { path: ' /a.txt ' })
    await expect(sent(mock).json()).resolves.toEqual({ path: '/a.txt' })

    vi.unstubAllGlobals()
    // cursor / rev / query / url 这些上游走 requireString 的字段同样要 trim。
    const cursor = mockDropbox(200, { entries: [], cursor: 'c', has_more: false })
    await call('list_folder_continue', { cursor: ' abc ' })
    await expect(sent(cursor).json()).resolves.toEqual({ cursor: 'abc' })
  })

  it('各 action 打各自的路由(_v2 后缀与 continue 路径最容易抄错)', async () => {
    const routes: Array<[string, unknown, string]> = [
      ['list_folder_continue', { cursor: 'c' }, '/2/files/list_folder/continue'],
      ['get_metadata', { path: '/a' }, '/2/files/get_metadata'],
      ['create_folder', { path: '/d' }, '/2/files/create_folder_v2'],
      ['move', { fromPath: '/a', toPath: '/b' }, '/2/files/move_v2'],
      ['copy', { fromPath: '/a', toPath: '/b' }, '/2/files/copy_v2'],
      ['delete', { path: '/a' }, '/2/files/delete_v2'],
      ['create_shared_link', { path: '/a' }, '/2/sharing/create_shared_link_with_settings'],
      ['list_shared_links', {}, '/2/sharing/list_shared_links'],
      ['search_files', { query: 'q' }, '/2/files/search_v2'],
      ['search_files_continue', { cursor: 'c' }, '/2/files/search/continue_v2'],
      ['get_temporary_link', { path: '/a' }, '/2/files/get_temporary_link'],
      ['save_url', { path: '/a', url: 'https://example.com/f' }, '/2/files/save_url'],
      ['save_url_check_job_status', { asyncJobId: 'j' }, '/2/files/save_url/check_job_status'],
      ['list_revisions', { path: '/a' }, '/2/files/list_revisions'],
      ['restore', { path: '/a', rev: '01' }, '/2/files/restore'],
      ['get_shared_link_metadata', { url: 'https://db.com/s/x' }, '/2/sharing/get_shared_link_metadata'],
      ['modify_shared_link', { url: 'https://db.com/s/x' }, '/2/sharing/modify_shared_link_settings'],
      ['get_tags', { paths: ['/a'] }, '/2/files/tags/get'],
    ]

    for (const [name, args, path] of routes) {
      vi.unstubAllGlobals()
      const mock = mockDropbox(200, {
        'entries': [],
        'links': [],
        'matches': [],
        'paths_to_tags': [],
        'cursor': 'c',
        'has_more': false,
        'name': 'a',
        'link': 'https://dl.dropbox.com/x',
        'metadata': FILE,
        '.tag': 'complete',
      })
      const res = await call(name, args)
      expect(res.status, `${name} 应当成功`).toBe(200)
      const url = new URL(sent(mock).url)
      expect(url.origin, `${name} 的 host`).toBe('https://api.dropboxapi.com')
      expect(url.pathname, `${name} 的路由`).toBe(path)
    }
  })

  it('get_shared_link_file 走内容面的 sharing 路由', async () => {
    const mock = mockDownload('abc', FILE)
    await call('get_shared_link_file', { url: 'https://db.com/s/x', path: '/inner.txt' })
    expect(sent(mock).url).toBe('https://content.dropboxapi.com/2/sharing/get_shared_link_file')
    expect(JSON.parse(sent(mock).headers.get('Dropbox-API-Arg') ?? '{}')).toEqual({
      url: 'https://db.com/s/x',
      path: '/inner.txt',
    })
  })

  it('search_files:一个 option 都没给时整个 options 不发;includeHighlights 才发 match_field_options', async () => {
    const bare = mockDropbox(200, { matches: [], has_more: false })
    await call('search_files', { query: 'hello' })
    await expect(sent(bare).json()).resolves.toEqual({ query: 'hello' })

    vi.unstubAllGlobals()
    const full = mockDropbox(200, { matches: [], has_more: false })
    await call('search_files', {
      query: 'hello',
      maxResults: 20,
      fileCategories: ['image', 'pdf'],
      includeHighlights: true,
    })
    await expect(sent(full).json()).resolves.toEqual({
      query: 'hello',
      options: { max_results: 20, file_categories: ['image', 'pdf'] },
      match_field_options: { include_highlights: true },
    })
  })

  it('create_shared_link 的 settings 空则不发;modify 的 settings 空也照发(上游如此)', async () => {
    const created = mockDropbox(200, { name: 'a', url: 'https://db.com/s/x' })
    await call('create_shared_link', { path: '/a' })
    await expect(sent(created).json()).resolves.toEqual({ path: '/a' })

    vi.unstubAllGlobals()
    const modified = mockDropbox(200, { name: 'a', url: 'https://db.com/s/x' })
    await call('modify_shared_link', { url: 'https://db.com/s/x' })
    await expect(sent(modified).json()).resolves.toEqual({ url: 'https://db.com/s/x', settings: {} })
  })

  it('modify 的密码字段名是 link_password,create 那边是 password', async () => {
    const created = mockDropbox(200, { name: 'a' })
    await call('create_shared_link', { path: '/a', password: 'pw', requestedVisibility: 'password' })
    await expect(sent(created).json()).resolves.toMatchObject({
      settings: { password: 'pw', requested_visibility: 'password' },
    })

    vi.unstubAllGlobals()
    const modified = mockDropbox(200, { name: 'a' })
    await call('modify_shared_link', { url: 'https://db.com/s/x', password: 'pw' })
    await expect(sent(modified).json()).resolves.toMatchObject({ settings: { link_password: 'pw' } })
  })
})

describe('响应整形', () => {
  it('get_current_account 把嵌套的 name/team/account_type 摊平,缺失字段记 null', async () => {
    mockDropbox(200, {
      account_id: 'dbid:1',
      name: { display_name: 'Ada L', given_name: 'Ada' },
      email: 'ada@example.com',
      email_verified: true,
      account_type: { '.tag': 'business' },
      team: { id: 'dbtid:1', name: 'Acme' },
    })
    await expect((await call('get_current_account', {})).json()).resolves.toEqual({
      content: {
        accountId: 'dbid:1',
        displayName: 'Ada L',
        abbreviatedName: null,
        givenName: 'Ada',
        surname: null,
        email: 'ada@example.com',
        emailVerified: true,
        disabled: false,
        locale: null,
        country: null,
        accountType: 'business',
        teamId: 'dbtid:1',
        teamName: 'Acme',
      },
    })
  })

  it('元数据裁剪成固定 15 个字段,未声明的上游字段丢掉', async () => {
    mockDropbox(200, {
      '.tag': 'file',
      'name': 'a.txt',
      'id': 'id:1',
      'path_display': '/A.txt',
      'path_lower': '/a.txt',
      'rev': '01',
      'size': 3,
      'is_downloadable': true,
      'property_groups': ['dropped'],
    })
    await expect((await call('get_metadata', { path: '/a.txt' })).json()).resolves.toEqual({
      content: {
        metadata: {
          tag: 'file',
          name: 'a.txt',
          id: 'id:1',
          pathDisplay: '/A.txt',
          pathLower: '/a.txt',
          clientModified: null,
          serverModified: null,
          rev: '01',
          sizeBytes: 3,
          isDownloadable: true,
          contentHash: null,
          url: null,
          expiresAt: null,
          sharingInfo: null,
          linkPermissions: null,
        },
      },
    })
  })

  it('.tag 缺席时按 rev/size/content_hash/is_downloadable 兜底成 file,都没有则 unknown', async () => {
    mockDropbox(200, { name: 'a.txt', id: 'id:1', rev: '01' })
    await expect((await call('get_metadata', { path: '/a.txt' })).json())
      .resolves.toMatchObject({ content: { metadata: { tag: 'file' } } })

    vi.unstubAllGlobals()
    mockDropbox(200, { name: 'docs', id: 'id:2' })
    await expect((await call('get_metadata', { path: '/docs' })).json())
      .resolves.toMatchObject({ content: { metadata: { tag: 'unknown' } } })
  })

  it('download_file 把字节编成 base64,MIME 取响应头,name 可被入参覆盖', async () => {
    mockDownload('hi', FILE, { contentType: 'text/plain' })
    await expect((await call('download_file', { path: '/a.txt', fileName: 'renamed.txt' })).json())
      .resolves.toEqual({
        content: {
          fileId: 'id:1',
          name: 'renamed.txt',
          mimeType: 'text/plain',
          sizeBytes: 3,
          contentBase64: 'aGk=',
        },
      })
  })

  it('download_file 响应没带 content-type 时兜底 application/octet-stream', async () => {
    // 注意用字节而不是字符串当 body:`new Response('hi')` 会被自动补上
    // `content-type: text/plain;charset=UTF-8`,就测不到"上游没给 content-type"这条路径了。
    mockDownload(new TextEncoder().encode('hi'), FILE)
    await expect((await call('download_file', { path: '/a.txt' })).json())
      .resolves.toMatchObject({ content: { name: 'a.txt', mimeType: 'application/octet-stream' } })
  })

  it('search_v2 的 match.metadata 再套一层 metadata,两种形状都要认', async () => {
    mockDropbox(200, {
      matches: [
        { match_type: { '.tag': 'filename' }, metadata: { metadata: FILE }, highlight_spans: [{ h: 1 }] },
        { metadata: FILE },
      ],
      cursor: null,
      has_more: false,
    })
    const res = await call('search_files', { query: 'a' })
    const body = (await res.json()) as {
      content: { matches: Array<{ matchType: string, metadata: { name: string } }> }
    }
    expect(body.content.matches).toHaveLength(2)
    expect(body.content.matches[0]).toMatchObject({ matchType: 'filename', metadata: { name: 'a.txt' } })
    // match_type 缺席时兜底 unknown。
    expect(body.content.matches[1]).toMatchObject({ matchType: 'unknown', metadata: { name: 'a.txt' } })
  })

  it('save_url 的完成态元数据可能在 complete、在 metadata、或就是载荷自身', async () => {
    mockDropbox(200, { '.tag': 'complete', 'complete': FILE })
    await expect((await call('save_url', { path: '/a', url: 'https://example.com/f' })).json())
      .resolves.toMatchObject({ content: { tag: 'complete', metadata: { name: 'a.txt' } } })

    vi.unstubAllGlobals()
    // 异步态:只有 job id,没有元数据。
    mockDropbox(200, { '.tag': 'async_job_id', 'async_job_id': 'job1' })
    await expect((await call('save_url', { path: '/a', url: 'https://example.com/f' })).json())
      .resolves.toEqual({
        content: { tag: 'async_job_id', asyncJobId: 'job1', metadata: null, failure: null },
      })
  })

  it('revoke_shared_link 成功时上游不回内容,这里回 {revoked:true} 而不是报空响应', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 200 }))))
    await expect((await call('revoke_shared_link', { url: 'https://db.com/s/x' })).json())
      .resolves.toEqual({ content: { revoked: true } })
  })

  it('其他路由的空响应算上游异常(不静默当成成功)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 200 }))))
    const res = await call('get_metadata', { path: '/a' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('get_tags 把 paths_to_tags 摊成 {path, tags[]}', async () => {
    mockDropbox(200, {
      paths_to_tags: [
        { path: '/a.txt', tags: [{ '.tag': 'user_generated_tag', 'tag_text': 'urgent' }, {}] },
      ],
    })
    await expect((await call('get_tags', { paths: ['/a.txt'] })).json()).resolves.toEqual({
      content: {
        pathsToTags: [{
          path: '/a.txt',
          tags: [
            { tag: 'user_generated_tag', tagText: 'urgent' },
            { tag: 'unknown', tagText: null },
          ],
        }],
      },
    })
  })

  it('出参契约字段缺失 → unavailable + retryable', async () => {
    // list_folder 少了 cursor。
    mockDropbox(200, { entries: [], has_more: false })
    const res = await call('list_folder', {})
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })

    vi.unstubAllGlobals()
    // get_current_account 少了 account_id。
    mockDropbox(200, { name: { display_name: 'Ada' } })
    await expect((await call('get_current_account', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('下载响应缺 dropbox-api-result 头 → unavailable(拿不到元数据就判不了是不是文件)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('hi', { status: 200 }))))
    const res = await call('download_file', { path: '/a.txt' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('校验与错误', () => {
  it('入参校验真的生效:空 cursor / 非法枚举 / 未声明字段 → 400 且不打上游', async () => {
    const mock = mockDropbox(200, {})
    expect((await call('list_folder_continue', { cursor: '   ' })).status).toBe(400)
    expect((await call('list_folder', { limit: 5000 })).status).toBe(400)
    expect((await call('upload_file', { path: '/a', text: 'x', mode: 'nope' })).status).toBe(400)
    expect((await call('get_current_account', { nope: 1 })).status).toBe(400)
    expect((await call('get_tags', { paths: [] })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('纯空白路径在本地就挡下(schema 的 z.string() 拦不住)', async () => {
    const mock = mockDropbox(200, {})
    const res = await call('get_metadata', { path: '   ' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('path')
    expect(mock).not.toHaveBeenCalled()
  })

  it('paths 全是空串等同没给路径', async () => {
    const mock = mockDropbox(200, {})
    const res = await call('get_tags', { paths: ['', ''] })
    expect(res.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('upload_file:text 与 contentBase64 必须恰好给一个', async () => {
    const mock = mockDropbox(200, FILE)
    expect((await call('upload_file', { path: '/a' })).status).toBe(400)
    expect((await call('upload_file', { path: '/a', text: 'x', contentBase64: 'aGk=' })).status).toBe(400)
    // contentBase64 是空串等同没给(上游 optionalString 语义)。
    expect((await call('upload_file', { path: '/a', contentBase64: '' })).status).toBe(400)
    expect(mock).not.toHaveBeenCalled()

    // 但 text 是空串算给了 —— 上传一个空文件是合法意图。
    const empty = mockDropbox(200, FILE)
    expect((await call('upload_file', { path: '/a', text: '' })).status).toBe(200)
    expect(await sent(empty).text()).toBe('')
  })

  it('非法 base64 被本地拒(Node 的 Buffer 会静默截断,atob 会抛)', async () => {
    const mock = mockDropbox(200, FILE)
    const res = await call('upload_file', { path: '/a', contentBase64: '!!!not-base64!!!' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('base64')
    expect(mock).not.toHaveBeenCalled()
  })

  it('mode \'update\' 缺 updateRev 时在本地拒(否则发出去的是残缺参数,必然 400)', async () => {
    const mock = mockDropbox(200, FILE)
    const res = await call('upload_file', { path: '/a', text: 'x', mode: 'update' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('updateRev')
    expect(mock).not.toHaveBeenCalled()
  })

  it('download_file 拿到文件夹元数据 → invalid_argument(路径给错了)', async () => {
    mockDownload('', { '.tag': 'folder', 'name': 'docs', 'id': 'id:2' })
    const res = await call('download_file', { path: '/docs' })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'invalid_argument' })
  })

  it('409 + path/not_found → not_found(Dropbox 把端点错误压在 409 上,靠 .tag 判别)', async () => {
    mockDropbox(409, { error_summary: 'path/not_found/...', error: { '.tag': 'path' } })
    const res = await call('get_metadata', { path: '/nope' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      code: 'not_found',
      // error_summary 结尾的 `/...` 被去掉。
      message: 'path/not_found',
    })
  })

  it('409 + path/conflict → conflict;409 但 tag 无从判别时才落回 conflict', async () => {
    mockDropbox(409, { error_summary: 'path/conflict/file/...', error: { '.tag': 'path' } })
    const conflict = await call('upload_file', { path: '/a', text: 'x' })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'conflict' })

    vi.unstubAllGlobals()
    mockDropbox(409, { error_summary: 'other/...' })
    await expect((await call('get_metadata', { path: '/a' })).json())
      .resolves.toMatchObject({ code: 'conflict', message: 'other' })
  })

  it('expired_access_token / invalid_access_token → permission_denied,即便状态是 409', async () => {
    mockDropbox(409, { error_summary: 'expired_access_token/...' })
    const expired = await call('get_metadata', { path: '/a' })
    expect(expired.status).toBe(401)
    await expect(expired.json()).resolves.toMatchObject({ code: 'permission_denied' })

    vi.unstubAllGlobals()
    mockDropbox(401, { error_summary: 'invalid_access_token/...' })
    expect((await call('get_metadata', { path: '/a' })).status).toBe(401)
  })

  it('too_many_write_operations → rate_limited + retryable(不是冲突)', async () => {
    mockDropbox(409, { error_summary: 'too_many_write_operations/...' })
    const res = await call('delete', { path: '/a' })
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('no_permission → permission_denied', async () => {
    mockDropbox(409, { error_summary: 'path/no_write_permission/...' })
    await expect((await call('upload_file', { path: '/a', text: 'x' })).json())
      .resolves.toMatchObject({ code: 'permission_denied' })
  })

  it('拿不到 error_summary 时退到 error 的 .tag 当消息', async () => {
    mockDropbox(400, { error: { '.tag': 'malformed_path' } })
    await expect((await call('get_metadata', { path: '/a' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'malformed_path' })
  })

  it('非 JSON 错误体(HTML / 纯文本)把原文当消息,按状态归一', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('  Error in call to API function  ', {
      status: 400,
      headers: { 'content-type': 'text/plain' },
    }))))
    await expect((await call('get_metadata', { path: '/a' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument', message: 'Error in call to API function' })
  })

  it('429 与 5xx 可重试', async () => {
    mockDropbox(429, { error_summary: 'too_many_requests/...' })
    await expect((await call('list_folder', {})).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })

    vi.unstubAllGlobals()
    mockDropbox(503, { error_summary: 'internal_error' })
    await expect((await call('list_folder', {})).json())
      .resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('2xx 上回非 JSON → unavailable + retryable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<html>oops</html>', { status: 200 }))))
    const res = await call('get_metadata', { path: '/a' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable', retryable: true })
  })

  it('没配 authRef → unavailable 且不打上游(内容面那条路径也一样)', async () => {
    const rpc = mockDropbox(200, {})
    const res = await call('list_folder', {}, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(rpc).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const download = mockDownload('hi', FILE)
    expect((await call('download_file', { path: '/a' }, { auth: null })).status).toBe(503)
    expect(download).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
    const upload = mockDropbox(200, FILE)
    expect((await call('upload_file', { path: '/a', text: 'x' }, { auth: null })).status).toBe(503)
    expect(upload).not.toHaveBeenCalled()
  })
})
