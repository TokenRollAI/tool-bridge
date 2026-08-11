# 决策:Plugin 走"进程内目录"形态——可用而非必须实例化,单进程装载

> 用途:记录 2026-08-11 用户拍板的 plugin 规模化部署形态,供 multi-plugin 装载与 binding: 传输实现引用。更新时机:实现落地、CF 侧约束实测或决策被推翻时。

- **背景**:计划在 monorepo 新增可能上千个 plugin,部署到自家机器(不全是 Cloudflare)。现契约假设"每个 plugin 是入站可达的独立 HTTP 服务",1000 个 plugin = 1000 个 endpoint/进程,不可运维。
- **决策**(用户原话要点):
  1. **单进程装载**:不为 plugin 单独起 Node server 或专用宿主进程;plugin 与网关同进程,性能最好、省 CPU。
  2. **可用 ≠ 实例化**:默认部署自带一整个"可用插件/内置 provider 目录"——它们只是代码(catalog),不占运行成本;只有 admin 挂载/配置某个插件时才被激活。"很多时候它就是一些代码,不是一定要插进去才行。"
  3. **Cloudflare 侧必须适配**:同一形态要能跑在 CF Worker 里(gateway 即"单进程")。
- **技术路线**(与现有契约零冲突):
  - plugin-sdk 的 plugin 本体就是 `{ fetch(request, env) }`,进程内调用 = 直接构造 Request 调 `plugin.fetch()`,envelope 协议(X-TB-Context/X-TB-Request-Id/X-TB-Upstream-Auth)原样复用,无网络跳。
  - manifest 已预留 `binding:<name>` endpoint 语法(`core/plugin/manifest.ts` BINDING_RE);缺的只是传输接线:`gateway/providers/pluginClient.ts` 的 `resolvePluginEndpoint` 对 binding: 现抛 501。实现 = 宿主注入 `Map<bindingName, fetchHandler>`(第五个宿主注入点),resolve 命中即进程内直调;健康探测同样进程内。
  - **注册面**:builtin `system/plugin` 增加"可用目录"列举(来自注入的 registry);挂载内置插件 = endpoint `binding:<id>` 的注册 + mount,免网络探活;手动注册外部 HTTP plugin 通道原样保留。
  - **CF 约束**:Worker bundle 有体积上限(免费 3MB/付费 10MB gzip),1000 个插件不一定全塞得进 gateway Worker → registry 必须是**构建期可选择的**(默认集/全集/自选集由构建入口决定;Node 宿主可全量并可懒加载 `import()`,CF 侧静态打包所选集合)。独立 Worker + 真 service binding 或外部 HTTP plugin 仍是超出体积时的逃生路径。
- **与 2026-07-07 [plugin-hosted-install.md](plugin-hosted-install.md) 的关系**:托管安装(部署进用户 CF 账户)解决的是"外部/第三方 plugin 分发";本决策解决的是"平台自带能力目录"。两者并存:in-repo 插件默认走进程内目录,外部插件走注册通道(HTTP 或托管安装)。
- **未决**:构建期插件集合的选择机制(env/配置文件/构建 flag);目录列举的权限面;binding 插件的 env(secrets)注入形态;懒加载在 Node 侧的落地(CF 侧不可行)。
