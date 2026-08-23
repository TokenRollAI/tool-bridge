# 当前协议契约

本文件是实现导航，不替代 `~help` 的运行时自描述。精确 schema 以 core 类型、builtin help 和当前代码为准。

## 表示与错误

- `GET /<path>/~help`：默认 Markdown；`Accept: text/plain` 返回 Help DSL；`Accept: application/json` 返回 Help JSON。
- `GET /<path>/~tree?depth=N`：返回经过身份可见性裁剪的树。
- `POST /~search`：全局工具搜索；只有宿主声明 search capability 时存在。
- `GET|POST|DELETE /<path>/~feedback[/<id>]`：具体路径的使用反馈、投票与管理；不是集中 builtin。
- `ALL /~mcp`：把当前身份可见工具投影为 MCP server。
- `GET /healthz`：公开健康信息，不证明认证数据面可用。
- 错误统一为 `{code,message,retryable}`；主要 code：not_found、permission_denied、invalid_argument、conflict、unavailable、rate_limited、internal。

未知 Help DSL 行与未知可选 capability 应忽略，这是协议演进能力；安全字段和未知写入参数不得静默忽略。

## 调用

- 唯一形态：`POST /<nodePath>/<command>`，body 即 arguments 本体。命令是节点下的**虚拟叶子**(不写 Registry），对一切可调用 kind(mcp/http/tool 工具、builtin/context/skillhub 命令、device shell/fs）一视同仁。没有 `{tool, arguments}` 信封。
- owner 节点的 `GET /<nodePath>/~help` 返回的每条 `cmds[].path` 都是带命令/工具叶子的完整直连路径(如 `/device/mac/shell/exec`），不是 owner 定位或展示提示。消费者必须原样把它用于 `GET <cmd.path>/~help` 与 `POST <cmd.path>`，不得再用 `node.path + cmd.name` 重建命令身份。
- 节点本身(无命令段的 `POST /<nodePath>`）不可调用，返回 404。
- 命令可被寻址：`GET /<nodePath>/<command>/~help`、`POST /<nodePath>/<command>`；`~tree` 只列权威注册拓扑,动态命令经 `~help`/`~search` 发现。
- 标识符大小写不敏感、规范化为小写：路径段、命令/工具名、export id、scope pattern 字面段、device 暴露路径都小写。输入大小写不敏感,存储与输出恒小写；规范化后冲突(如上游同时暴露 `Foo`/`foo`)→ `invalid_argument`，不选其一。命令名含 `/`、为空、以 `~` 开头、为 `.`/`..` 一律拒。第三方(MCP/HTTP 上游)原始工具名是外部身份,适配器维护 `公开小写名 → 上游原名` 映射,不改上游大小写。
- `Page<T>` 为 `{items,cursor?}`，默认 limit 50、最大 200；cursor 只表示继续位置，不是授权凭据。

公开 HTBP 与 plugin/v2 是两层不同的 wire，不能互相套用：

| 边界 | URL | body | `tool` 的含义 |
|---|---|---|---|
| 调用方 → HTBP gateway | `POST <cmds[].path>` | 裸 arguments 对象 | 不存在；命令身份已经在路径叶子中 |
| gateway → plugin/v2 | `POST <manifest.endpoint>`(固定 endpoint) | `{tool,arguments}` | plugin 内部方法名，由平台适配层生成 |

因此，公开请求向 owner 路径发送 `{tool,arguments}` 必须拒绝；反过来，全仓清理公开旧信封时不得删除 plugin/v2 适配层的合法内部信封。

## 节点

当前 `NodeKind`：directory、mcp、http、builtin、context、device、remote、tool、skillhub。

常见配置：

- mcp：http URL、headers、authRef/OAuth、工具 virtualize。
- http：base URL、工具定义、认证引用。
- tool/context：provider、export?、authRef?、providerConfig?。
- remote：远端 baseUrl 与 skRef；受 host allowlist、Via 环与跳数限制。
- device：由设备 hello 代写，不走普通用户 registry write。
- skillhub：R2/S3 技能存储。

所有路径先规范化；保留段和保留根在服务端权威拒绝。`virtualize` 的 hide/rename/prefix/describe 只改变投影视图，不改变上游身份。

remote host allowlist 为空时拒绝所有联邦目标。生效集合是部署期 env 基线与 `system/federation` 运行时条目的并集；env 条目不可经 API 删除。remote 出站身份只从自身 `skRef` 解析，不转发本地调用者 SK。

## 权限

Action：read、write、call、register、admin。scope 使用完整路径 glob；deny 优先。`scopes: []` 表示无权限。不可见路径以 404 表达。

注册路径还受 SK 的 `registerPaths` 约束。调用者的 SK 不向上游透传；remote/plugin/provider 凭证从 SecretStore 引用解析。

节点归属：`system/registry` 的 write/delete 若目标已被他人 SK 注册（且非 `system:auto` 物化），默认 `conflict`；持目标路径 `admin` scope 的调用者例外，可接管（write）或清理（delete）他人注册的节点——`register` scope 仍须通过。这是 admin 清理 stale/orphaned 节点的支持路径。

## Feedback

Feedback 附着在具体节点或其工具子路径，根路径不接受反馈。`GET` 列表/详情需要目标路径的 read；`POST` 提交或投票还需要 call；`DELETE` 清理单条反馈需要 admin。read 不通过时按可见性规则返回 404。

条目按净分与时间排序；默认可见的头部条目以精简形状进入该路径的 `~help`。宿主装配 Search 时，同一批头部反馈的 title/detail 进入该节点的工具搜索派生索引。CLI `tb feedback` 与 Dashboard 节点详情消费相同端点。

Feedback 是低频、非权威协作数据。Workers KV 宿主允许并发 submit/vote 的最终一致窗口，不把投票结果当作强一致状态。

## builtin

| 路径 | 命令 |
|---|---|
| `system/sk` | list、get、write、update、delete |
| `system/secret` | set、list、delete |
| `system/registry` | list、get、write、update、delete |
| `system/status` | get |
| `system/plugin` | list、get、write、update、delete、health |
| `system/catalog` | list、get、search |
| `system/federation` | list、add、remove |
| `system/annotation` | set、get、remove、list |

`system/catalog` 是 read-only 内置目录；list/search 的 `exportDetails` 是逐 export 挂载契约。`system/plugin` 是显式注册表，不再提供旧的 binding catalog 命令。

## plugin/v2

Manifest 描述部署：`id`、`protocolVersion:'plugin/v2'`、`endpoint`、`auth`、`healthPath`、`enabled`。`~describe` 描述 exports；每个 export 决定 profile、methods/capabilities、auth、凭证字段、挂载配置与可选 probe。

plugin/v2 的 endpoint 是平台到 plugin 的固定内部传输入口，不是公开 HTBP 命令路径；调用体保留 `{tool:<plugin 方法>,arguments:<命名参数>}`。公开调用先在 gateway 以完整命令路径和裸 body 完成路由，再由 provider 适配层转换为该内部信封。

标准内置流程从编译期 catalog 直接挂载。外部 HTTP(S) endpoint 需注册、探活、抓取并校验 descriptor；自定义宿主可显式装配 `binding:<name>` handler。

## Context

动词(全小写,cmd 名 = provider 方法名）：`list`、`get`(读）；`write`、`update`、`delete`(写）；`search`(可选能力）。全部可选,能力由 provider handler 存在性推导——`~help` 只列真实存在的动词,无任何写动词即只读。content 可内联或返回 `$ref`;大对象 URL 必须短期有效并受签名/宿主边界保护。skillhub 动词:`list`、`get`(传 `file` 参数则取单文件,内部走 provider `get_file`)、`search`、`publish`、`remove`。

## 设备

设备先连 `/system/device/ws?deviceId=...`，hello 声明 expose；服务端验证身份与 `registerPaths` 后代写 `device/<id>/...`。完整帧集合是 hello、ready、error、call、result、ping、pong、cancel。`call` 帧的 `path` 相对 mountPath 且**含命令叶子段**(如 `shell/exec`、`fs/get`、`<mount 相对路径>/<命令>`）——与直连调用一致,命令是路径最后一段,不再单列 `tool` 字段。PING/PONG 是稳定字面量，支持边缘 auto-response；只有当前 generation 进入 ready 后才能执行 call，连接替换后旧 generation 的 message、close 与迟到结果不得污染新连接。

call id 在同一设备进程内用于执行中合并与有界结果缓存；当前契约不承诺跨进程 exactly-once。cancel 是协作式提示：设备向 handler 的 AbortSignal 发信号，忽略 signal 的 handler 仍可完成并缓存结果，不能把 cancel 表述为外部副作用已撤销。未知 handler 异常对 wire 脱敏，result 必须可 JSON 序列化。

call 帧带可选 `context`（caller.keyId/owner、traceId、createdAt、expiresAt），由网关鉴权后签发，不接受来自调用 arguments，故意不含 scopes/SK/敏感参数。授权判定仍全在网关侧（转发前 `check(...,'call')`）；设备只消费 context 做审计与限时，不做 scope 裁决。`expiresAt` 是网关权威时间戳（对齐 `DEVICE_CALL_TIMEOUT_MS`），设备复检以此为准，不信任本地时钟。老网关不带 context，新设备须按缺省显式降级；老设备 decoder 忽略未知字段。

设备在线状态在 `~tree`/`~help`/`device ls` 上表示为三态 `presence: { state: 'online'|'stale'|'offline', lastSeenAt? }`，取代旧的裸 `online` 布尔。`state` 由存储层的 `online` 位（连接建立/拆除事件）结合 `lastSeenAt`（hello 与心跳观察）在投影时派生：online 但心跳超时降级 `stale`，从而不谎报"可立即路由"。`presence` 只是发现提示，调用可路由性仍以宿主活动 socket 为准。存储层 TreeNode（`system/registry` 返回）仍保留 `online` 与新增的 `lastSeenAt`；wire 派生只发生在树/help 投影处，读路径不回写权威状态。

`@tool-bridge/sdk/device` 的安全作者面只声明可路由回设备的 tool/context 节点；raw wire decoder 仍兼容完整 DeviceExpose。移动端默认是前台实时在线设备：宿主将 AppState 映射为 suspend/resume，后台永久在线或进程被杀后的任务属于另一个异步队列/推送能力。

## CLI 契约

顶层命令族以 `packages/cli/src/program.ts` 为准。全局 `--json`、`--base-url`、`--sk`、`--timeout` 可位于根、组或叶子位置；未知 flag、多余 positional、缺必填参数均失败。当前集成入口只接受 `--credential`，卸载不再提供隐藏 `--purge`；凭证清理由 `tb secret` 显式完成。

CLI 和 Dashboard 的便利校验不替代服务端权威校验。接口或字段变化时按 API / CLI / Dashboard 三入口同轮更新。

`tb daemon install/status/logs/restart/uninstall` 是当前 Linux 主机上 systemd user service、私有配置与 journal 的本地生命周期入口，不是 HTBP 服务端管理能力；因此它天然没有对应的 Dashboard 或直接 API 入口，不适用三入口对等要求。
