/**
 * Context Layer 类型(原样转写;方法签名异步化以兼容对象存储后端)。
 *
 * 四核心动词(List/Get/Update/Write)每个 Provider 必须实现;可选能力
 * (Search/Watch/Delete)须在 ~describe 的 capabilities 中声明,调用方先探测再用。
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

export interface SearchOptions extends ListOptions {
  /** 缺省 keyword;semantic 需 capabilities 声明 "search:semantic",未声明 → invalid_argument。 */
  mode?: 'keyword' | 'semantic'
}

/** 四核心动词 + 可选能力。 */
export interface ContextProvider {
  Delete?(path: string): Promise<void>
  /** 读取单个条目(含内容);不存在 → not_found。 */
  Get(path: string): Promise<ContextEntry>
  /** 枚举条目(浅层列表 + 分页);path 为 namespace 内相对路径前缀。 */
  List(path: string, opts?: ListOptions): Promise<Page<ContextEntryMeta>>
  Search?(query: string, opts?: SearchOptions): Promise<Page<ContextEntryMeta>>
  /** 部分更新已存在条目的内容或 metadata;不存在 → not_found。 */
  Update(path: string, patch: ContextPatch): Promise<ContextEntryMeta>
  /** 暂不实现(占位)。 */
  Watch?(path: string): Promise<{ watchId: string }>
  /** 创建或整体替换条目(幂等 upsert)。 */
  Write(path: string, entry: ContextEntryInput): Promise<ContextEntryMeta>
}
