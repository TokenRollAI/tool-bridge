/**
 * ConvertAPI 的业务逻辑。
 *
 * 迁移自 open-connector `src/providers/convertapi/executors.ts`,语义等价、写法本地化:
 * 凭证从 `ctx.upstreamAuth` 取,出站走 `guardedFetch`,错误抛 `TBError` 七码。
 *
 * ConvertAPI 的形状特点:
 * - 请求体是 **multipart form**,字段名是大驼峰(`File`/`StoreFile`/`OcrMode`…),
 *   与入参的小驼峰不同名,故逐个显式映射。
 * - `StoreFile=true` 让上游把转换结果存成临时下载 URL 再回给我们,而不是把二进制
 *   直接塞进响应体 —— 这是上游的选择,保留。
 * - 转换是**同步**的:一次调用要等 PDF 转完。上游为此设了 120s 超时,这里保留。
 */

import type { z } from 'zod/v4'
import { TBError } from '@tool-bridge/plugin-sdk'
import type { convertPdfToDocxInput } from './schema'
import { integerValue as integer, asJsonObject as toRecord } from '../_runtime/jsonValue'
import { assertPublicHttpUrl, guardedFetch } from '../_runtime/guardedFetch'
import { type ProviderContext, requireApiKey } from '../_runtime/plugin'
import { upstreamError } from '../_runtime/upstreamError'

const SERVICE = 'convertapi'
const API_BASE = 'https://v2.convertapi.com'
const CONVERT_PDF_TO_DOCX_PATH = '/convert/pdf/to/docx'
const REQUEST_TIMEOUT_MS = 120_000

type Json = Record<string, unknown>

/** 非空字符串;上游 `optionalString` 的等价物。 */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** ConvertAPI 的错误文案在 `Message`,少数路径用小写 `message`。 */
function errorMessage(payload: unknown, status: number): string {
  const record = toRecord(payload)
  return text(record?.Message) ?? text(record?.message) ?? `ConvertAPI 返回 HTTP ${status}`
}

/**
 * 上游的状态映射有两处不能照搬成"原样透传":415(不支持的媒体类型)按 400 归类,
 * 503 按 429 归类 —— ConvertAPI 用 503 表示"当前排队满了,稍后重试",不是永久故障。
 */
function convertapiError(status: number, message: string): TBError {
  if (status === 415) return upstreamError(400, message)
  if (status === 503) return upstreamError(429, message)
  if (status >= 500) return upstreamError(502, message)
  return upstreamError(status, message)
}

async function readPayload(response: Response): Promise<unknown> {
  const body = await response.text()
  if (body.trim() === '') return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw upstreamError(502, 'ConvertAPI 返回了非 JSON 响应')
  }
}

function setOptional(form: FormData, name: string, value: unknown): void {
  if (value !== undefined) form.set(name, String(value))
}

export async function convertPdfToDocx(
  input: z.infer<typeof convertPdfToDocxInput>,
  ctx: ProviderContext,
): Promise<Json> {
  // fileUrl 是**让 ConvertAPI 去拉**的地址,不是我们自己请求的,故 guardedFetch 管不到它。
  // 不校验就等于把上游当成开放代理去打内网(转发型 SSRF),所以这里显式过同一层策略。
  try {
    assertPublicHttpUrl(input.fileUrl)
  } catch {
    throw new TBError('invalid_argument', 'fileUrl 必须是公网可达的 http(s) 地址')
  }

  const form = new FormData()
  form.set('File', input.fileUrl)
  // 结果存成临时 URL 回传,而不是把 DOCX 二进制塞进 JSON 响应。
  form.set('StoreFile', 'true')
  setOptional(form, 'FileName', input.fileName)
  setOptional(form, 'Timeout', input.timeout)
  setOptional(form, 'Password', input.password)
  setOptional(form, 'PageRange', input.pageRange)
  setOptional(form, 'Layout', input.layout)
  setOptional(form, 'OcrMode', input.ocrMode)
  setOptional(form, 'OcrLanguage', input.ocrLanguage)
  setOptional(form, 'OcrEngine', input.ocrEngine)
  setOptional(form, 'Annotations', input.annotations)

  let response: Response
  try {
    response = await guardedFetch(new URL(CONVERT_PDF_TO_DOCX_PATH, API_BASE).toString(), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${requireApiKey(ctx, SERVICE)}`,
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // 只归一超时;出站策略拦截等是**永久**拒绝,标成 retryable 会让调用方白重试。
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw upstreamError(504, `ConvertAPI ${REQUEST_TIMEOUT_MS / 1000}s 内没有返回转换结果`)
    }
    throw error
  }

  const payload = await readPayload(response)
  if (!response.ok) throw convertapiError(response.status, errorMessage(payload, response.status))

  const record = toRecord(payload)
  const rawFiles = Array.isArray(record?.Files) ? record.Files : []
  const files = rawFiles
    .map((value): Json | undefined => {
      const file = toRecord(value)
      if (file === undefined) return undefined
      // 上游还会把每个文件转存进本地 transit storage 并回一个 transitFile;
      // tool-bridge 没有这层存储,故只透出 ConvertAPI 自己的临时下载 URL
      // (schema 里 transitFile 是 optional,省略合法)。
      return Object.fromEntries(Object.entries({
        fileName: text(file.FileName),
        fileExt: text(file.FileExt),
        fileSize: integer(file.FileSize),
        fileId: text(file.FileId),
        url: text(file.Url),
      }).filter(([, entry]) => entry !== undefined))
    })
    .filter((file): file is Json => file !== undefined)

  if (files.length === 0) {
    // 上游说成功了却没给任何文件:契约破了,不是调用方的错。
    throw upstreamError(502, 'ConvertAPI 的成功响应里没有转换结果文件')
  }

  const conversionCost = integer(record?.ConversionCost)
  return conversionCost === undefined ? { files } : { conversionCost, files }
}
