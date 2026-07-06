# 项目速览(MUST)

> 用途:每轮开发 Agent 开场必读的项目恒定事实(是什么、规范体系、纪律、术语)。更新时机:仅当 docs/ 五份规范或 LOOP/DOD 的顶层结构变化时更新;易变状态在 [current-state.md](current-state.md)。

## 一句话定义

tool-bridge 是一个"自描述、可反向注册、协议开放的工具与上下文网关"——任何会 HTTP fetch 的 Agent,凭一个 Secret Key + 一个 BaseURL,就能发现并使用一个组织的全部工具、上下文与设备(docs/Vision.md:3)。产品形态 = 一棵自描述的 HTBP 树 + 围绕它的注册/鉴权/SDK/管理面(docs/Vision.md:17);Agent、CLI、Dashboard 三类消费者共用同一入口(docs/Vision.md:21)。

本仓库是 v1(私有仓库 TokenRollAI/tool-bridge)的重写,当前 docs-only。v1 缺口与可复用资产见 [../reference/v1-lessons.md](../reference/v1-lessons.md)。

## 七个 User Case(一句话版,docs/Vision.md:59-112)

1. **Admin 初始化**:`tb init` 干净账户拉起部署,产出 BaseURL + Admin SK(明文仅一次)。
2. **添加 Context**:配 AK/SK 把 R2/S3 挂成 namespace,三入口读写同一条目,凭证不外泄。
3. **反向注册**:内网机器 `tb connect` 经 WebSocket 把 shell/fs 挂上树,Agent 无差别访问。
4. **自部署**:`docker run` 单容器拉起同一棵树,重启数据持久。
5. **Agent 使用**:只会 fetch 的 Agent 凭 SK+BaseURL 从 `/~help` 渐进发现并调用工具/读 context。
6. **Dashboard 使用**:输入 SK+BaseURL,树导航 + 表单调用 + SK 管理。
7. **CLI 使用**:`tb --json` 覆盖全部管理面,无管理旁路。

## 规范体系:五份 docs 各自角色(DOD.md:5)

| 文件 | 角色 |
|---|---|
| docs/Vision.md | 愿景 + 七个 User Case(需求真源) |
| docs/Architecture.md | 模块划分 M1-M10 与边界 |
| docs/Proto.md | 接口契约(实现对齐的唯一规范,642 行,检索地图见 [../reference/proto-map.md](../reference/proto-map.md)) |
| docs/Plugin.md | 第三方插件契约 |
| docs/Reference.md | 外部事实(HTBP/MCP/CF 限制、选型清单、v1) |

**实现与文档冲突以 docs 为准;docs 自身错误先修 docs 再写码**(DOD.md:5)。docs 的已知缺口与实现注意项见 [../memory/doc-gaps.md](../memory/doc-gaps.md)。

## 不可违背纪律(LOOP.md:5-11)

0. **及时 commit**:少量多次,不要一股脑提交。
1. **docs 是宪法**:偏离先改 docs(写明理由)再写码;docs 自相矛盾先修 docs。
2. **DOD 是验收法官**:只有 DOD 勾选项算进度,勾选唯一依据是可重跑命令及其输出。
3. **不伪造进度**:测试失败就报失败;跳过明说;消耗真实外部资源的测试打 tag,每轮每 tag 最多跑一次。
4. **成熟框架优先**(TB.md:112 注意 0):手写 HTTP 路由/MCP 协议/S3 签名/argv 解析/重试/持久化都是违例;表外新需求先调研(docs/Reference.md:80)。

每轮五步循环(取 context → 定目标 → 实现 → 验证 → 沉淀)与单轮输出格式以根目录 LOOP.md 为准。

## 术语表精选

- **HTBP**:HTTP ToolBridge Protocol,本项目实现的开放协议(仓库 TokenRollAI/HTBP,Draft);tool-bridge 是参考实现(docs/Reference.md:5-12)。核心理念:能 fetch URL 就能学会用对应工具。
- **双平面**:Control Plane(`~help`/`~skill`/`~register`)+ Data Plane(节点调用)(docs/Reference.md:14)。
- **`~help`**:必选保留段,默认 `text/plain` 紧凑 Help DSL(面向 LLM);**`~skill`**:推荐,`text/markdown` 指南,远端文本不可覆盖用户意图(防注入);**`~tree?depth=N`**:受限深度树视图(默认 2,上限 8);**`~register`**:自助注册;**`~describe`**:Plugin 元信息(docs/Proto.md:106,docs/Reference.md:15-17)。
- **Help DSL**:`htbp 0.1` 头 + `node`/`cmd` 行 + 缩进属性(`q/h/body/returns/scope/effect/confirm`);每 cmd 必声明 `scope`;未知行必须忽略(docs/Proto.md:116-131)。格式详见 [../reference/proto-map.md](../reference/proto-map.md)。
- **渐进式发现**:已知路径 → `~help` → 最小调用 →(必要时)`~skill` → 按需下钻,省 token(docs/Reference.md:19)。
- **node kind**:`directory`/`mcp`/`http`/`builtin`/`context`/`device`/`remote` 七种(docs/Proto.md:263)。
- **NodeRegistry**:builtin `system/registry`,List/Get/Write/Update/Delete/Resolve;**一切"挂上树"的动作最终落 `NodeRegistry.Write`**(统一注册面,docs/Architecture.md:32)。
- **SK(Secret Key)**:唯一凭证形态,opaque token,sha256 哈希存查;记录 owner(`user:`/`agent:`/`device:`)与 scopes(docs/Proto.md:160-170)。
- **Scope**:`(路径 glob 模式, 动作集, effect?)`;动作 = read/write/call/register/admin;deny 优先、无匹配默认拒(docs/Proto.md:176-193)。
- **Admin SK**:部署时自动生成,scope=`**` 全动作,用于签发更细 SK(docs/Proto.md:223)。
- **Authorizer.Check**:唯一权限判定入口,所有模块只依赖它(docs/Proto.md:200,docs/Architecture.md:183)。
- **SecretStore**:builtin `system/secret`,上游凭证 AES-256-GCM 加密只写不读,主密钥 `TB_SECRET_ENCRYPTION_KEY` env-only(docs/Proto.md:241-251)。
- **authRef / skRef**:节点配置中对 SecretStore 凭证的引用名(凭证本体不出网关,docs/Proto.md:304);**pluginToken**:Plugin 回调平台的令牌,签发仅一次(docs/Proto.md:576)。
- **Provider**:纯接口。ToolProvider = List/Get/Call(docs/Proto.md §4.1);ContextProvider = List/Get/Update/Write 四动词 + 可选 Search/Watch/Delete(docs/Proto.md §5.1);内置与 Plugin 地位对等。
- **工具虚拟化**:namespace 前缀 / rename / hide / description override,对外只暴露虚拟名(docs/Proto.md:271,v1 已验证)。
- **remote 联邦**:kind=`remote` 联到另一 HTBP 服务,白名单 + `X-TB-Via` 环检测(maxHops 默认 4,docs/Proto.md §3.4)。
- **`$ref`**:超限大对象(>1 MiB)返回预签名 URL,不过网关流量;无 presign 时网关中转下载兜底(docs/Proto.md:408,docs/Reference.md:86)。
- **宿主注入点**:StateStore / ObjectStore / SecretStore / DeviceTransport 四个接口收敛 CF 与 Node 差异,业务代码零分叉(docs/Proto.md:522,docs/Reference.md:85)。
- **packages/core**:树/Auth/协议编解码的纯逻辑,无宿主依赖;网关/SDK/CLI 都装配它,Phase 1 起即公共内核(docs/Architecture.md:200,DOD.md:19)。
- **Watt**:上层 Agent Runtime 平台,tool-bridge 是其 M4 Tool Gateway 上游依赖;本仓库不含任何 Watt 特有语义;DOD/LOOP 方法论移植自 Watt(docs/Reference.md:88-91)。
