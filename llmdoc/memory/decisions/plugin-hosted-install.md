# 决策:Plugin 走托管化安装(插件市场),CF 宿主经 scoped API token 自动部署

> 用途:记录 2026-07-07 用户拍板的 plugin 分发/安装形态决策,供实现插件市场与多挂载时引用。更新时机:未决项落定、详细设计定稿或决策被推翻时。

- **背景**:现有 Plugin 契约假设"入站可达的 HTTP endpoint",社区 plugin(如飞书集成)要求每个消费组织手动部署一份服务再注册,摩擦过大。
- **决策**:
  1. 提供集成安装体验:Dashboard/CLI 一键安装 → 平台自动把插件 Worker 部署进**用户自己的 CF 账户**(经用户录入的 scoped API token,Workers Scripts:Edit,存 SecretStore)→ 自动签发并注入 pluginToken → 自动注册 + 挂载。不走 Workers for Platforms(付费门槛),信任模型保持"一组织一账户"。
  2. 同一 plugin 安装一次、支持**多次挂载**;为此扩展 envelope CallContext 增加 `mountPath` 与 `mountConfig`(每挂载非敏感配置);敏感凭证仍走安装时 Worker secret 注入,不经 envelope 传输。
  3. **手动 `tb plugin register` 通道保留**:市场安装是体验层,底下走同一套 PluginRegistry 契约。
- **依据的代码事实**:pluginClient.ts 已预留 `binding:<name>` 端点(501);挂载校验无 provider 唯一性约束(多挂载今天即可行,但 CallContext 不含挂载信息,plugin 无法区分);Dashboard 已有 @rjsf 可渲染配置表单。
- **详细设计**:迭代稿见 `.llmdoc-tmp/plugin-marketplace-design.md`(临时文件,实现启动时以当时对齐版本为准);包格式(worker.js bundle + tb-plugin.json + configSchema + sha256 索引)、安装器事务(builtin system/plugin 新增 Install/Uninstall)、阶段 P0~P2。
- **未决**:每挂载敏感凭证是否接受"多安装"方案;Install/Uninstall 的 builtin 归属;索引仓库治理。
