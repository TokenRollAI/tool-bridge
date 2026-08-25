import { describe, expect, it } from 'vitest'
import { createConvertapiPlugin } from '../../src/convertapi/index'
import { createProviderHarness } from '../support/providerHarness'
import { convertapiActions } from '../../src/convertapi/schema'

/**
 * ConvertAPI 迁移产物的 wire 级验收。重点在 multipart 字段名的大驼峰映射、
 * `StoreFile=true` 的保留,以及 415/503 两个非常规状态映射。
 */

const API_KEY = 'convertapi_test_token'
const plugin = createConvertapiPlugin()

const {
  call,
  envelope,
  sent,
  mockJson: mockConvertapi,
} = createProviderHarness({
  mountPath: 'files/convertapi',
  plugin,
  upstreamAuth: API_KEY,
})

const OK_PAYLOAD = {
  ConversionCost: 3,
  Files: [{
    FileName: 'report.docx',
    FileExt: 'docx',
    FileSize: 20480,
    FileId: 'f_1',
    Url: 'https://v2.convertapi.com/d/f_1',
  }],
}

describe('契约面', () => {
  it('List 出全部 action,且都带 Zod 派生的 schema', async () => {
    const res = await envelope({ tool: 'List', arguments: {} })
    const tools = (await res.json()) as Array<{ inputSchema?: unknown, name: string, outputSchema?: unknown }>
    expect(tools).toHaveLength(Object.keys(convertapiActions).length)
    expect(tools).toHaveLength(1)
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} 缺 inputSchema`).toBeDefined()
      expect(tool.outputSchema, `${tool.name} 缺 outputSchema`).toBeDefined()
    }
  })
})

describe('convert_pdf_to_docx', () => {
  it('multipart 字段用大驼峰,凭证走 Bearer,StoreFile 恒为 true', async () => {
    const mock = mockConvertapi(200, OK_PAYLOAD)
    await call('convert_pdf_to_docx', {
      fileUrl: 'https://example.com/report.pdf',
      fileName: 'report',
      timeout: 60,
      ocrMode: 'force',
      ocrLanguage: 'en',
      layout: 'exact',
    })

    const request = sent(mock)
    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://v2.convertapi.com/convert/pdf/to/docx')
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`)
    const form = await request.formData()
    expect(form.get('File')).toBe('https://example.com/report.pdf')
    expect(form.get('StoreFile')).toBe('true')
    expect(form.get('FileName')).toBe('report')
    expect(form.get('Timeout')).toBe('60')
    expect(form.get('OcrMode')).toBe('force')
    expect(form.get('OcrLanguage')).toBe('en')
    expect(form.get('Layout')).toBe('exact')
    // 省略的可选参数不发,免得覆盖上游自己的默认值。
    expect(form.has('Password')).toBe(false)
    expect(form.has('PageRange')).toBe(false)
    expect(form.has('Annotations')).toBe(false)
  })

  it('响应整形成小驼峰,缺失字段被剔掉', async () => {
    mockConvertapi(200, { Files: [{ FileId: 'f_2', Url: 'https://v2.convertapi.com/d/f_2' }] })
    const res = await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' })
    await expect(res.json()).resolves.toEqual({
      content: { files: [{ fileId: 'f_2', url: 'https://v2.convertapi.com/d/f_2' }] },
    })
  })

  it('conversionCost 存在时一并透出', async () => {
    mockConvertapi(200, OK_PAYLOAD)
    const res = await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' })
    await expect(res.json()).resolves.toMatchObject({
      content: { conversionCost: 3, files: [{ fileName: 'report.docx', fileSize: 20480 }] },
    })
  })

  it('上游说成功却没给文件 → 502', async () => {
    mockConvertapi(200, { ConversionCost: 1, Files: [] })
    const res = await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' })
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ code: 'unavailable' })
  })
})

describe('校验与错误', () => {
  it('入参校验生效:fileUrl 不是 URL → 400 且不打上游', async () => {
    const mock = mockConvertapi(200, OK_PAYLOAD)
    const res = await call('convert_pdf_to_docx', { fileUrl: 'not a url' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('invalid_argument')
    expect(mock).not.toHaveBeenCalled()
  })

  it('fileUrl 指向内网 → 400 且不打上游(转发型 SSRF)', async () => {
    const mock = mockConvertapi(200, OK_PAYLOAD)
    const res = await call('convert_pdf_to_docx', { fileUrl: 'http://169.254.169.254/latest/meta-data' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('公网')
    expect(mock).not.toHaveBeenCalled()
  })

  it('上游错误按状态归一,消息取自 Message', async () => {
    mockConvertapi(401, { Message: 'Invalid API token' })
    await expect((await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' })).json())
      .resolves.toMatchObject({ code: 'permission_denied', message: 'Invalid API token' })

    mockConvertapi(429, { Message: 'Too many requests' })
    await expect((await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('415 归成 400、503 归成 429(ConvertAPI 用 503 表示排队满)', async () => {
    mockConvertapi(415, { Message: 'Unsupported source format' })
    await expect((await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' })).json())
      .resolves.toMatchObject({ code: 'invalid_argument' })

    mockConvertapi(503, { Message: 'Service busy' })
    await expect((await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' })).json())
      .resolves.toMatchObject({ code: 'rate_limited', retryable: true })
  })

  it('没配 authRef → 503 且不打上游', async () => {
    const mock = mockConvertapi(200, OK_PAYLOAD)
    const res = await call('convert_pdf_to_docx', { fileUrl: 'https://example.com/a.pdf' }, { auth: null })
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toContain('authRef')
    expect(mock).not.toHaveBeenCalled()
  })
})
