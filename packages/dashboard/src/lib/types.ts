/** 固定控制面 wire 类型来自 SDK public artifact，不再由 Dashboard 手抄。 */
export type {
  Action,
  DeviceOperationDetail,
  DeviceOperationState,
  DeviceOperationSummary,
  FeedbackView,
  HelpCommand as HelpCmd,
  HelpJson,
  NodeKind,
  Page,
  Presence,
  PresenceState,
  RegistryNode,
  TBErrorBody,
  ToolSearchItem,
  ToolSearchPage,
  ToolSearchRequest,
  ToolSpec,
  TreeJson,
} from '@tool-bridge/sdk/client'

/**
 * builtin/system 管理面视图类型同样来自 SDK(真源在 core,经 /client 型别出口内联)。
 * 此前 Dashboard 手抄一份——契约理解漂移曾造成 credentialFields 分流的真 bug
 * (8 个 provider 中招),现在漂移在编译期暴露。
 * 命名差异:Dashboard 历史上把含 exports 的注册视图叫 PluginManifest(core 的
 * PluginView)、把 SK 投影叫 SecretKeyInfo(core 的 SecretKeyView),别名保持消费面不变。
 */
export { ACTIONS } from '@tool-bridge/sdk/client'
export type {
  CatalogExportAuth,
  CatalogExportDetails,
  CatalogListItem,
  ContextEntry,
  ContextEntryMeta,
  FederationHost,
  PluginCredentialField,
  PluginExport,
  PluginExportAuth,
  PluginView as PluginManifest,
  PluginMountConfigField,
  PluginProfile,
  PluginRegistration,
  Scope,
  SecretKeyView as SecretKeyInfo,
  SkillDetail,
  SkillFile,
  SkillSummary,
} from '@tool-bridge/sdk/client'
import type { PluginHealthRecord } from '@tool-bridge/sdk/client'

/** system/plugin health cmd 返回(按需探活;id 由调用侧拼接展示)。 */
export interface PluginHealth extends Pick<PluginHealthRecord, 'checkedAt' | 'healthy'> {
  id: string
}
