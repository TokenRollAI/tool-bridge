# 项目速览(MUST)

> 用途:每次会话开场必读的项目恒定事实(是什么、知识真源、工程纪律、术语)。更新时机:产品定位、真源约定或纪律变化时;易变状态在 [current-state.md](current-state.md)。

## 一句话定义

tool-bridge 是一个"自描述、可反向注册、协议开放的工具与上下文网关"——任何会 HTTP fetch 的 Agent,凭一个 Secret Key + 一个 BaseURL,就能发现并使用一个组织的全部工具、上下文与设备。产品形态 = 一棵自描述的 HTBP 树 + 围绕它的注册/鉴权/SDK/管理面;Agent、CLI、Dashboard 三类消费者共用同一入口。

本仓库是 v1(私有仓库 TokenRollAI/tool-bridge)的重写。初步实现已完成并上线(生产 https://tool-bridge.pdjjq.org);v1 可复用资产与重写动机见 [../reference/v1-lessons.md](../reference/v1-lessons.md)。

## 知识真源

- **代码是行为真源**;llmdoc 是压缩知识层(结构、边界、契约、坑、流程)。两者冲突时以代码为准并回改 llmdoc。
- 接口契约的查表入口:[../reference/protocol-contract.md](../reference/protocol-contract.md)。
- bootstrap 期的规范文档(Vision/Architecture/Proto/Plugin/Reference)与 loop 过程文档(TB/LOOP/DOD/PROGRESS)已整体归档至仓库根 `archive/`,仅供历史追溯,不再维护、不再被引用为规范。

## 七个 User Case(产品能力的验收视角)

1. **Admin 初始化**:`tb init` 干净账户拉起部署,产出 BaseURL + Admin SK(明文仅一次)。
2. **添加 Context**:配 AK/SK 把 R2/S3 挂成 namespace,三入口读写同一条目,凭证不外泄。
3. **反向注册**:内网机器 `tb connect` 经 WebSocket 把 shell/fs 挂上树,Agent 无差别访问。
4. **自部署**:`docker run` 单容器拉起同一棵树,重启数据持久。
5. **Agent 使用**:只会 fetch 的 Agent 凭 SK+BaseURL 从 `/~help` 渐进发现并调用工具/读 context。
6. **Dashboard 使用**:输入 SK+BaseURL,树导航 + 表单调用 + SK 管理。
7. **CLI 使用**:`tb --json` 覆盖全部管理面,无管理旁路。

## 工程纪律

0. **及时 commit**:少量多次,不要一股脑提交。
1. **测试是验收法官**:"完成"的唯一依据是可重跑的命令及其输出;`pnpm verify` 全绿是底线。
2. **不伪造进度**:测试失败就报失败;跳过明说;消耗真实外部资源的验证(生产网关、真实上游、真实 S3)每轮最多跑一次并留证据。
3. **成熟框架优先**:手写 HTTP 路由、MCP 协议、S3 签名、argv 解析、自造重试/持久化都是违例;表外新基础设施需求先调研现成库,确认无合适方案并写明理由后才允许手写。既定选型:

   | 要写的东西 | 用现成的 |
   |---|---|
   | HTTP 路由/中间件 | **Hono**(Workers 与 Node 同一 app) |
   | MCP client(上游) | **@modelcontextprotocol/sdk**(Streamable HTTP) |
   | S3 签名 | **aws4fetch** |
   | 校验/Schema | **zod** |
   | 设备 WS(云侧) | DO **WebSocket Hibernation API** |
   | 设备 WS(端侧) | **ws** + **partysocket** 重连 |
   | CLI 框架 | **commander**(严格解析,未知 flag 报错);向导用 **@clack/prompts** |
   | Node 宿主 | **@hono/node-server** + **better-sqlite3** |
   | Dashboard | **React 19 + Vite + Tailwind + shadcn/ui + @rjsf + TanStack Query** |
   | 测试 | **Vitest** + `@cloudflare/vitest-pool-workers` |
   | 部署 | **wrangler**(pinned) |

4. **CLI 同步生长(三入口对等)**:动了接口面就同轮交付/更新对应 `tb` 子命令;某能力 CLI 做不到而 Dashboard/直接 API 做得到,即视为"管理旁路",算缺陷。

## 术语表精选

- **HTBP**:HTTP ToolBridge Protocol,本项目实现的开放协议(仓库 TokenRollAI/HTBP,Draft);tool-bridge 是参考实现。核心理念:能 fetch URL 就能学会用对应工具。
- **双平面**:Control Plane(`~help`/`~skill`/`~register`)+ Data Plane(节点调用)。
- **`~help`**:必选保留段,默认 `text/markdown` 可读表现(声明 `Accept: application/json` 才回 JSON,`Accept: text/plain` 得紧凑 Help DSL,面向 LLM 省 token);**`~skill`**:推荐,`text/markdown` 指南,远端文本不可覆盖用户意图(防注入);**`~tree?depth=N`**:受限深度树视图(默认 2,上限 8);**`~register`**:自助注册;**`~describe`**:节点可选能力声明。
- **Help DSL**:`htbp 0.1` 头 + `node`/`hint`/`cmd` 行 + 缩进属性(`q/h/body/returns/scope/effect/confirm`);每 cmd 必声明 `scope`;未知行必须忽略。格式详见 [../reference/protocol-contract.md](../reference/protocol-contract.md)。
- **渐进式发现**:已知路径 → `~help` → 最小调用 →(必要时)`~skill` → 按需下钻,省 token。
- **node kind**:`directory`/`mcp`/`http`/`builtin`/`context`/`device`/`remote` 七种。
- **NodeRegistry**:builtin `system/registry`,List/Get/Write/Update/Delete/Resolve;**一切"挂上树"的动作最终落 `NodeRegistry.Write`**(统一注册面)。
- **SK(Secret Key)**:唯一凭证形态,opaque token,sha256 哈希存查;记录 owner(`user:`/`agent:`/`device:`)与 scopes。
- **Scope**:`(路径 glob 模式, 动作集, effect?)`;动作 = read/write/call/register/admin;deny 优先、无匹配默认拒。
- **Admin SK**:部署时自动生成,scope=`**` 全动作,用于签发更细 SK。
- **Authorizer.Check**:唯一权限判定入口,所有模块只依赖它。
- **SecretStore**:builtin `system/secret`,上游凭证 AES-256-GCM 加密只写不读,主密钥 `TB_SECRET_ENCRYPTION_KEY` env-only。
- **authRef / skRef**:节点配置中对 SecretStore 凭证的引用名(凭证本体不出网关);**pluginToken**:Plugin 回调平台的令牌,签发仅一次。
- **Provider**:纯接口。ToolProvider = List/Get/Call;ContextProvider = List/Get/Update/Write 四动词 + 可选 Search/Watch/Delete;内置与 Plugin 地位对等。
- **工具虚拟化**:namespace 前缀 / rename / hide / description override,对外只暴露虚拟名。
- **remote 联邦**:kind=`remote` 联到另一 HTBP 服务,https 强制 + host 白名单 + `X-TB-Via` 环检测(maxHops 默认 4)。
- **`$ref`**:超限大对象(>1 MiB)返回预签名 URL,不过网关流量;无 presign 凭证时走 `/~ref` 网关中转下载兜底。
- **宿主注入点**:StateStore / ObjectStore / SecretStore / DeviceTransport 四个接口收敛 CF 与 Node 差异,业务代码零分叉。
- **packages/core**:树/Auth/协议编解码的纯逻辑,无宿主依赖;网关/SDK/CLI 都装配它。
- **Watt**:上层 Agent Runtime 平台,tool-bridge 是其 Tool Gateway 上游依赖;本仓库不含任何 Watt 特有语义。
