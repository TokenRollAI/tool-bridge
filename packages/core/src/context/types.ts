/**
 * Context Layer 类型(原样转写;方法签名异步化以兼容对象存储后端)。
 *
 * 全部动词可选:能力由 handler 存在性推导(见 context/capabilities.ts)。
 * 可选能力(Search/Delete)另在 ~describe 的 capabilities 中声明,调用方先探测再用。
 */

import type { ListOptions, Page, Timestamp, URI } from '../types'

export interface ContextEntryMeta {
  /** "text/markdown" | "application/json" | ... */
  contentType: string
  metadata: Record<string, string>
  size?: number
  updatedAt: Timestamp
  /** node://<namespace-path>/<entry-path>;目录条目以尾 '/' 表示。 */
  uri: URI
  /** 乐观并发:Update/Write 可携带 ifVersion;对象存储后端 = etag。 */
  version: string
}

export interface ContextEntry extends ContextEntryMeta {
  /** 文本或 JSON;大对象返回 { $ref: <预签名或中转 URL> }。 */
  content: string | unknown
}

export interface ContextEntryInput {
  content: string | unknown
  /** 字符串 content 必填(缺失 → invalid_argument);非字符串 content 缺省 application/json。 */
  contentType?: string
  /** 不匹配 → conflict。 */
  ifVersion?: string
  metadata?: Record<string, string>
}

export interface ContextPatch {
  content?: string | unknown
  ifVersion?: string
  /** 浅合并。 */
  metadata?: Record<string, string>
}

/** 为 namespace 内单个对象签发的限时直传凭证。URL 本身是 bearer secret。 */
export interface ContextUploadGrant {
  /** 凭证失效时间(ISO 8601)。 */
  expiresAt: Timestamp
  /** 上传时必须原样携带的请求头；这些值可能参与签名。 */
  headers: Record<string, string>
  method: 'PUT'
  /** 上传成功后可长期保存和分享的稳定引用；不包含临时凭证。 */
  uri: URI
  /** 仅交给上传方使用的限时 URL，不应写入日志或持久化。 */
  url: string
}

export interface ContextUploadInput {
  /** 将要上传的媒体类型；会被签入 PUT 请求。 */
  contentType: string
  /** 缺省 false：仅当目标不存在时写入；true 才允许覆盖既有对象。 */
  overwrite?: boolean
  /** namespace 内的目标 entry path。 */
  path: string
}

export interface SearchOptions extends ListOptions {
  /** 缺省 keyword;semantic 需 capabilities 声明 "search:semantic",未声明 → invalid_argument。 */
  mode?: 'keyword' | 'semantic'
}

/**
 * Context provider。**全部动词可选**:能力由 handler 存在性推导(context/capabilities.ts),
 * `~help` 只列真实存在的操作,没有任何写动词即自动只读。
 *
 * 这样只读资源、纯搜索服务、append-only 存储都能如实表达自己,不必为满足接口而伪造
 * 方法或抛 unimplemented。未实现的动词在数据面按 unknown cmd 拒绝(invalid_argument)。
 */
export interface ContextProvider {
  delete?(path: string): Promise<void>
  /** 读取单个条目(含内容);不存在 → not_found。 */
  get?(path: string): Promise<ContextEntry>
  /** 枚举条目(浅层列表 + 分页);path 为 namespace 内相对路径前缀。 */
  list?(path: string, opts?: ListOptions): Promise<Page<ContextEntryMeta>>
  search?(query: string, opts?: SearchOptions): Promise<Page<ContextEntryMeta>>
  /** 部分更新已存在条目的内容或 metadata;不存在 → not_found。 */
  update?(path: string, patch: ContextPatch): Promise<ContextEntryMeta>
  /** 创建或整体替换条目(幂等 upsert)。 */
  write?(path: string, entry: ContextEntryInput): Promise<ContextEntryMeta>
}
