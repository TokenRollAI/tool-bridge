# 模块与边界

> 用途:实现时确认"这段代码归哪个模块、依赖方向对不对、落在哪个宿主原语上"的裁决文档。更新时机:模块边界、Provider 面或宿主落地变化时。

## 全局模式

- 每层由**纯接口**定义,层间只经接口交互,无旁路。
- **单一 HTBP 树**:所有能力都是树上节点(八种 kind:directory/mcp/http/builtin/context/device/remote/tool/skillhub)。
- **统一注册面**:一切"挂上树"的动作最终落 `NodeRegistry.Write`——tool/context/remote 直接写,device 由网关代写(`registeredBy` 记 device),Plugin 注册后经 NodeRegistry 引用挂载;context 无独立 Registry。
- **`Authorizer.Check` 是唯一权限判定入口**:所有调用点都过它,任何模块不得自行判权;PEP 在网关分发前的中间件。
- **凭证不出网关**:上游凭证经 `tb secret set` 进 SecretStore(AES-256-GCM,只写不读),节点配置只存 `authRef`/`skRef` 引用名;Plugin 上游凭证同此语义——存平台 SecretStore(kind:'tool' config `authRef`),调用时 resolve 后经 `X-TB-Upstream-Auth` 注入,plugin 不自持凭证(泄漏 PLUGIN_TOKEN 拿不到凭证,轮换免重部署)。
- **四个宿主注入点**收敛 CF 与 Node 差异:`StateStore`(KV/SQLite/内存)、`ObjectStore`(R2/S3/FS/内存,`presign?` 可选,无 presign 统一走网关中转下载兜底)、`SecretStore`、`DeviceTransport`。业务代码零分叉。

## 模块表(职责 → 实际代码落点)

| 模块 | 职责 | core 落点 | 宿主落点 |
|---|---|---|---|
| HTBP Tree(核心枢纽) | 节点注册表、路由、`~help`/`~skill`/`~tree`/`~describe`、内容协商、调用分发 | `tree/` + `htbp/` | gateway `tbApp.ts`(宿主中立 createTbApp)+ `kvStateStore.ts` |
| Tool Layer | mcp/http/builtin Provider 聚合与调用代理、虚拟化、remote 联邦 | `tool/` | gateway `providers/mcp|http|remote|toolCache` |
| Context Layer | 多来源上下文统一读写检索面(四动词 + Search + `$ref`) | `context/` | gateway `providers/r2Object|s3Object|s3Sign` + `refToken.ts` |
| Skillhub Layer | Agent Skill 仓库(每 skill = `<id>/SKILL.md` + 文本文件;List/Get/Search/Publish/Remove) | `skillhub/`(frontmatter 解析 + provider,复用 context 的 ObjectStore/objectProvider) | 复用 context 的 gateway providers(r2/s3);网关 `tbApp.ts` 装配 `skillhubProviderFor` 落 `skills/<path>` 前缀 |
| Device Gateway | 设备 WS 反向注册 + 调用转发 | `device/`(帧/状态机/shell 白名单/设备侧 client) | **协议行为单一真源:gateway `deviceHello.ts`(processDeviceHello,宿主中立)**;两个宿主胶水:gateway `deviceSession.ts`(DO,WS hibernation)与 server `deviceHub.ts`(Node ws);cli `deviceRuntime.ts`;core `node/`(FsObjectStore/shellExecutor) |
| Auth(横切) | SK 签发/作用域/访问判定/SecretStore | `auth/` + `secret/` | gateway 认证中间件;SK 哈希与密文存 StateStore |
| builtin 管理面 | `system/*` 七模块:sk / secret / registry / status / plugin / federation / annotation | `builtin/` | 经 gateway dispatch |
| Agent 反馈 | `~feedback` 保留段(per-path 一级协议能力,非 builtin):提交/投票/下钻,头部条目注入 ~help | core `feedback/` 存储 + gateway `tbApp.ts` 路由 | 权限判定落目标 path |
| SDK | 内嵌 TB 实例 / 程序化注册 / 反向连接 | —(装配层) | `packages/sdk`:createToolBridge = core + gateway 的 createTbApp + 内存宿主缺省 |
| CLI | 纯 API 客户端 `tb`,18 个子命令一一映射接口面,**无专用端点** | — | `packages/cli`(commander;npm 发布物) |
| Plugin System | 自定义 Provider 注册与生命周期(探活/契约校验/信封传输) | `plugin/` | gateway `providers/pluginClient|pluginTool|pluginContext` + builtin `system/plugin`;首个 in-repo plugin 参考实现:`packages/plugin-feishu`(CF Worker,飞书 TAT 自动换发) |
| Dashboard | `~help` 通用渲染器 + 管理表单,**无专用后端** | — | `packages/dashboard`(React SPA)经 gateway Static Assets 挂 `/ui` |
| 部署 | CF 与 Docker 两条路径产出同一棵树 | — | CF:`scripts/provision.mjs` + wrangler;Docker/Node:`packages/server`(SQLite/FS/ws DeviceHub)+ 根 Dockerfile,见 [../guides/docker-host.md](../guides/docker-host.md) |
| 设备边车 | pod 部署即反向注册到 `device/`:常驻 `tb connect` 的 tb-agent 镜像(k8s sidecar) | — | `packages/cli/Dockerfile` → `ghcr.io/tokenrollai/tool-bridge/tb-agent`(与 CLI 同源同版本),见 [../guides/k8s-device-sidecar.md](../guides/k8s-device-sidecar.md) |

## 依赖方向要点

- **core 是纯逻辑基座**:无宿主依赖(唯一运行时依赖 zod),不直接 fetch;gateway、SDK、CLI、server 都装配它。core 的 `./node` 子导出是唯一含 Node API 的部分(FsObjectStore/shellExecutor,设备侧与 Docker/Node 宿主复用)。
- **gateway 的 `tbApp.ts` 是宿主中立装配面**:接收 deps(StateStore/ObjectStore/SecretStore/设备宿主/version)产出 Hono app;`app.ts` 只做 Workers Env→deps 适配,server `server.ts` 做 Node env→deps 适配。SDK 直接复用 createTbApp,这就是"网关与 SDK 同一棵树"的机制保证。
- **设备 hello 单一真源**:hello 验证 + 落库统一在 gateway `src/deviceHello.ts`(`processDeviceHello`,宿主中立,dev exports `./deviceHello`);`deviceSession.ts`(DO)与 server `deviceHub.ts` 只是宿主胶水——防两宿主树形态漂移,改协议行为只改 deviceHello。
- **providers 承担全部 I/O**:core `tool/`、`context/`、`plugin/` 只放纯逻辑(拼装/映射/校验/归一);上游 fetch、MCP SDK、aws4fetch 签名都在 gateway `providers/`。

## 存储与宿主原语分工

| 原语 | 用途 | 关键限制 |
|---|---|---|
| KV `tb-kv` | SK 哈希表(`sha256(sk)→记录`)、树配置、plugin manifest、secret 密文 | 最终一致,1 write/s/key;吊销跨边缘通常约 60s、也可能更久,不得叠认证内存缓存;list+get 一致性坑见 [../guides/workers-kv-pitfalls.md](../guides/workers-kv-pitfalls.md) |
| R2 `tb-r2` | r2 context provider、大对象 `$ref` | **binding 不支持 presign**——预签名走 S3 兼容端点 + R2 Access Key(aws4fetch);凭证空缺走 `/~ref` 网关中转 |
| DO `DeviceSession` | 每设备一个,WS hibernation 空闲零计费 | 唤醒后内存态须从 storage 恢复;见 [../guides/do-websocket-hibernation.md](../guides/do-websocket-hibernation.md) |
| Static Assets | Dashboard 与 gateway 同 Worker(`../dashboard/dist`,binding `ASSETS`) | `run_worker_first: true`,一切请求先进 Worker;静态资源仅由 `/ui` 路由显式转发,SPA 回退严格限定 `/ui`,不吞根 `~help`/数据面/`system/*`;`/ui` 免认证(登录页须无 SK 可加载)。已有 `ui.integration.test.ts` 覆盖 |

## 网关请求处理与判定次序(tbApp.ts)

- 树外免认证端点:`/healthz`、`/~ref/<token>`(HMAC token 即授权)、`/ui` 静态资源。
- 其余全路由过认证中间件:Bearer → `identify`,失败 401 裸 TBError(缺失/无法识别/disabled/过期一视同仁)。
- 通配路由按 pathname 末段分派(`~help`/`~tree`/`~skill`/`~describe`/`~register`/数据面 POST);每个 handler 先 `check(ctx, path, 'read')` 可见性判定,再按 cmd 声明的 scope 过 `Check`。
- **deny == not_found**:对 (path,'read') 判 deny 的节点,`~help`/`~tree`/数据面一律 404,不泄露存在性;可见但目标动作被 deny 才 403。judgment 次序:read→404,再 scope→403。
- remote 透传:`~help`/`~tree`/`~skill`/调用命中 remote 节点(或其后代)→ 改写路径打到 baseUrl;`~tree` 聚合远端子树并把路径映射回本地挂载前缀,计入本地 depth/node 预算。
- workerd 坑:handler 里必须 `await`,裸 `return asyncFn()` 的 reject 会被误报 unhandled rejection。
- 安全响应头在宿主中立 `createTbApp` 统一注入,覆盖 Workers/Node/SDK;OAuth callback 另用 HTML 实体编码 + `default-src 'none'` CSP + `no-store`。中间件须保留 Node adapter 的流对象与 101/WebSocket 语义,优先原位改 header,不可变时才克隆普通 Response。

## 两条注册通道

- `POST <path>/~register` 是**受限 SK 通道**:只判 URL path 上的 (path,'register') + 注册路径收紧规则,不要求 `system/registry` 可见,body.path 必须等于 URL path。
- `system/registry` 数据面是**管理通道**:须对 registry 可见且持 register/admin。
- 两者最终都落 `NodeRegistry.Write`;中间 directory 自动物化(`registeredBy: system:auto`),卸载后空中间节点级联回收。
- **当前安全缺口:**两条入口都没有对 NodeConfig 中的 `skRef/authRef` 做独立使用授权;“Secret 由管理员创建”不等于“引用只能由管理员写入”。建立统一 Secret Reference ACL 前,不得把 remote/plugin/mcp/http/context 的代理凭证视为受信 capability 边界。

## 引导(bootstrap.ts)

Workers 无启动钩子,首请求惰性引导(模块级 promise 防重入 + KV 幂等标志);Workers 必须预置 `TB_BOOTSTRAP_ADMIN_SK`,缺失时 fail closed,不随机生成或写日志。宿主中立 `runBootstrap` 为 SDK/开发兼容保留可选随机生成;**当前 Node/Docker server 也默认走该兼容路径并把随机 Admin SK 写入 stdout,这是待修安全缺口,生产必须显式配置 bootstrap secret**。引导物化 `system` directory + sk/secret/registry/status/plugin/federation/annotation 七个 builtin(`registeredBy: system:boot`);Plugin 引导节点幂等 ensure。

## Provider 边界细则

- **mcp**(`providers/mcp.ts`):官方 SDK Streamable HTTP;`Mcp-Session-Id` 会话复用(入 StateStore,失效 404 重握手一次);`authRef` 经 SecretStore.resolve 注入 Bearer;禁用 standalone SSE GET(fetch wrapper 返 405);schema 校验用 `@cfworker/json-schema`(workerd 禁 eval)。
- **http**(`providers/http.ts`):`buildHttpRequest` 处理 `{param}` 占位与 GET/DELETE query、POST/PUT JSON body;`authHeader/authScheme` 控制上游凭证注入;非 2xx 与网络错误经 `normalizeUpstreamError` 收敛为 TBError。
- **remote**(`providers/remote.ts`):注册时与调用时都校验 https 强制 + host allowlist(生效白名单 = env 基线 `TB_REMOTE_ALLOWLIST` ∪ 运行时条目,后者经 builtin `system/federation` 增删、存 `tool/allowlist.ts` 的 RemoteAllowlistStore,gateway `tbApp.ts` 请求期 `resolveRemoteSettings` 合并);本地调用者 SK 不外传,出站 Authorization 来自节点配置的 `skRef` 换发,每次成功使用记录 actor keyId/owner、traceId、节点、skRef、方法与去 query 的目标且不得记录明文凭据。当前注册入口未验证写入者是否有权使用该引用,审计不能替代授权;resolve 不到 Secret 时还会静默匿名降级,两者均须 fail closed 收口。`X-TB-Via` 入站先判环/跳数再追加自身。
- **r2/s3 object**(`r2Object.ts`/`s3Object.ts`):etag=version 乐观并发;s3 用 aws4fetch(`s3Sign.ts`);挂载时做连通探测;ttl 懒回收;readOnly 拒写并在 help 隐藏写动词。
- **plugin**(`pluginClient/pluginTool/pluginContext`):平台→Plugin 传输用 `X-TB-Context`(base64url 信封,唯一上下文载体)+ `X-TB-Request-Id`(重试去重);挂载 `authRef` 给出时 resolve 上游凭证经 `X-TB-Upstream-Auth`(base64url)注入,resolve 失败 → unavailable 快速失败;注册时探活 + `~describe`/`~help` 契约校验;周期探活不自动注销。
- **工具级两级披露**:节点 `~help` 是索引(cmd 行 + `h` 一句话),`GET /<node>/<tool>/~help` 给全量 spec;Dashboard schema 懒补水同源。
- **可见性细则**:父目录/`~tree` 对 mcp/http/remote 调用节点按 read+call 裁剪(无 call 的 SK 看不到);直接访问仍按 read→404 / call→403。

## Dashboard 集成

无专用后端:`api.ts` `baseUrl:''` 同源直接消费 HTBP 数据面与 `~help`;SK 只存浏览器(localStorage 多 profile),因此任何同源脚本执行都属于凭据边界。`sessionStorage` 或浏览器端加密不能隔离同源 XSS;若迁移 HttpOnly cookie,须同步设计服务端 session、CSRF 与多网关连接模型。表单由 `~help` JSON 的 `inputSchema`(真 JSON Schema)经 @rjsf 渲染。部署编排:`pnpm deploy:all` 先 `dashboard build` 再 `gateway deploy`。

## 命名注意

设备通道接口命名:`DeviceTransport`(宿主注入点)/ `DeviceConn`(单连接)/ 帧类型 `DeviceFrame`。历史文档曾用 `DeviceChannel` 泛指,实现一律用前者。
