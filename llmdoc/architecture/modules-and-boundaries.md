# 模块与边界(M1-M10)

> 用途:实现时确认"这段代码归哪个模块、依赖方向对不对、落在哪个宿主原语上"的裁决文档。更新时机:docs/Architecture.md 模块划分变化,或实现中确立了新的边界决策时。

## 全局模式(docs/Architecture.md:27-32)

- 每层由**纯接口**定义,层间只经接口交互,无旁路(L27)。
- **单一 HTBP 树**:所有能力都是树上节点。
- **统一注册面**:一切"挂上树"的动作最终落 `NodeRegistry.Write`(L32)——tool/context/remote 直接写,device 由 Gateway 代写(Proto.md:481),Plugin 注册后经 NodeRegistry 引用挂载(Proto §8.1);context 无独立 Registry(Proto.md:431)。

## 模块表

| # | 模块 | 职责(Architecture.md 行号) | 边界要点 | CF 落地 | Docker 落地 |
|---|---|---|---|---|---|
| M1 | HTBP Tree(核心) | 节点注册表、路由、`~help`/`~skill`/`~tree`、内容协商、调用分发(51–77) | 所有对外供给收敛于此;内聚 NodeRegistry;调用点必过 M5 | Worker + KV | Hono(Node)+ SQLite |
| M2 | Tool Layer | mcp/http/builtin Provider 聚合与调用代理(81–102) | 实现 `ToolProvider`;**凭证不出网关**(L96);权限在调用点判(L97) | Worker + MCP client(Streamable HTTP) | 同核心逻辑 |
| M3 | Context Layer | 多来源上下文统一读写检索面(106–129) | 实现 `ContextProvider`;挂载复用 NodeRegistry(L129);对 Agent 单一抽象(L122) | R2 + KV/D1 + Plugin | 本地 FS/SQLite + S3 |
| M4 | Device Gateway | 设备反向注册 + 调用转发(133–158) | WS 帧协议(Proto §6);经 M5 判 register + §2.4 路径规则;代写 NodeRegistry(L158) | Durable Object(WS hibernation) | ws(Node) |
| M5 | Auth(横切) | SK 签发/作用域/访问判定(162–185) | `Authorizer.Check` 唯一判定入口,所有模块只依赖它(L183);PEP 在 M1 分发前中间件(L178) | KV(SK 哈希)+ Worker 中间件 | SQLite |
| M6 | SDK | 内嵌 TB Server / 程序化注册 / 反向连接(189–204) | 公开面 = Proto 接口面(L199);核心逻辑在 `packages/core` 纯逻辑无宿主依赖(L200) | npm 包(核心同构) | 同左 |
| M7 | CLI | 部署/管理/挂载/反向注册命令行(208–226) | 纯 API 客户端,子命令一一映射 Proto 接口(L210);**无专用端点** | npm 包 `tb` | 同左 |
| M8 | Plugin System | 自定义 Provider 注册与生命周期(230–245) | `PluginRegistry` + `PluginLifecycle`;注册后经 NodeRegistry 挂载 | KV(manifest)+ 外部 HTTP/Worker | 同核心逻辑 |
| M9 | Dashboard | `~help` 通用渲染器 + 管理表单(249–253) | **无专用后端**,渲染 `system/*` 子树 `~help`;SPA 回退严格限 `/ui`,不得吞根 `~help`/`POST`/`system/*`(L253) | 同 Worker(Static Assets `/ui`) | 同镜像静态托管 |
| M10 | Server/部署 | 两条部署路径产出同一棵树(257–266) | 宿主抽象只依赖 StateStore + ObjectStore,WS 按宿主注入(L266) | wrangler(`tb init`) | Docker 镜像 |

## 依赖方向要点

- **M1 是核心枢纽**:所有对外供给收敛于此(Architecture.md:51);M2/M3/M4/M8 都以 Provider/Registry 形态被 M1 分发。
- **M5 是横切依赖**:所有调用点都过 `Authorizer.Check`(Architecture.md:23);任何模块不得自行判权。
- **`packages/core` 是纯逻辑基座**(树/Auth/协议编解码,无宿主依赖):M1 网关、M6 SDK、M7 CLI 都装配它(Architecture.md:200);从 Phase 1 起就是公共内核,Phase 5 只补公开封装(DOD.md:19)。
- **凭证不出网关**:上游凭证经 `tb secret set` 进 SecretStore(AES-256-GCM,只写不读),节点配置只存 authRef/skRef 引用名(Proto.md:304);Plugin 场景凭证留在 Plugin 侧,平台不经手(docs/Plugin.md:58)。

## 存储与宿主原语分工(docs/Reference.md §4,Architecture.md:286-302)

| 原语 | 用途 | 关键限制 |
|---|---|---|
| KV `tb-state` | M5 SK 哈希表(`sha256(sk)→记录`)、M1 树配置、M8 manifest | 最终一致,1 write/s/key;**吊销传播窗口 ≤60s**(Proto.md:225) |
| R2 `tb-context` | M3 r2 provider、大对象 `$ref` | **binding 不支持 presign**——预签名走 S3 兼容端点 + R2 Access Key(aws4fetch) |
| DO `DeviceSession` | M4 每设备一个,WS hibernation 空闲零计费 | 单值 ≤2 MB;requestId↔响应待决表存 DO,休眠唤醒可恢复(docs/Reference.md:60) |
| D1 `tb-audit` | 审计留痕 | 后期可选 |
| Static Assets | M9 Dashboard 与 gateway 同 Worker | 路由次序 Phase 6 前 spike 核实(DOD.md:115) |

四个宿主注入点(Proto.md:522):`StateStore`(KV/SQLite/内存)、`ObjectStore`(R2/FS/S3,`presign?` 可选,无 presign 统一走网关中转下载兜底,docs/Reference.md:86)、`SecretStore`、`DeviceTransport`。

## Phase → 模块映射(DOD.md)

| Phase | 模块 | 一句话目标 |
|---|---|---|
| 0 | 骨架 | 能部署、能测试、能回滚的空网关(monorepo:core/gateway/cli) |
| 1 | M5 + M1 | SK 判定 + HTBP 核心树 + SecretStore(Proto §0/§1/§2/§3) |
| 2 | M2 | 上游 mcp/http 挂载调用 + remote 联邦(§3.4/§4) |
| 3 | M3 | Context 四动词 + Search + namespace 挂载(§5) |
| 4 | M4 | Device WS 反向注册全链路(§6) |
| 5 | M6 + M8 | SDK 公开封装 + Plugin 注册生命周期(§7/§8) |
| 6 | M9 + M10 | Dashboard + Docker + `tb init` 闭环 |
| 7 | — | 七条 E2E 验收 |

引导顺序(Architecture.md:304):部署 Worker/DO → 生成 Admin SK → 注册 5 个 builtin 节点(status/sk/secret/registry/plugin)→ Dashboard 可用。

## 命名注意

Device 通道接口以 Proto 命名为准:`DeviceTransport`(Proto.md:538)/ `DeviceConn`(Proto.md:541)/ 帧类型 `DeviceFrame`(Proto.md:449)。Architecture 早期用 `DeviceChannel` 泛指该抽象,已于 commit 0d48b06 修订(Architecture.md:157 改列 DeviceTransport/DeviceConn,:27 保留口语化名但加括注);历史记录见 [../memory/doc-gaps.md](../memory/doc-gaps.md) 已处理区 G1。
