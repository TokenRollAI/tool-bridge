<div align="center">

<img src="tool-bridge.png" alt="tool-bridge" width="160" />

# tool-bridge

**把工具、上下文、设备和远端服务组织成一棵带权限的、自描述的 HTTP 树。**

Agent 只需要一个 BaseURL 和一个 Secret Key，就能发现能力、阅读契约并发起调用；不要求安装特定 SDK，也不要求运行 MCP client。

简体中文 | [English](README.en.md) | [在线文档](https://tool-bridge.tokenroll.ai/)

[![npm: cli](https://img.shields.io/npm/v/@tool-bridge/cli?label=%40tool-bridge%2Fcli)](https://www.npmjs.com/package/@tool-bridge/cli)
[![npm: sdk](https://img.shields.io/npm/v/@tool-bridge/sdk?label=%40tool-bridge%2Fsdk)](https://www.npmjs.com/package/@tool-bridge/sdk)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/TokenRollAI/tool-bridge/tree/main/template)

</div>

> [!IMPORTANT]
> tool-bridge 目前处于 **pre-launch** 开发阶段。Cloudflare、Node/Docker、SDK、CLI 和 Dashboard 已能组成完整使用闭环，但项目尚无正式生产环境，也暂不承诺稳定性 SLA。现在适合自托管试用、内部集成和参与开发；升级前请阅读发布说明并保留数据备份。

## tool-bridge 是什么

tool-bridge 是 [HTBP（HTTP ToolBridge Protocol）](https://github.com/TokenRollAI/HTBP)的参考实现。它把原本分散在 MCP server、HTTP API、对象存储、本地机器和其他网关里的能力投影到同一棵树上：

```text
Agent / CLI / Dashboard / MCP client
                │
        BaseURL + scoped SK
                │
                ▼
┌──────────────────────────────────────┐
│              tool-bridge             │
│  ~help · ~tree · ~search · ~feedback │
│  路径权限 · SecretStore · Federation  │
└───────────┬──────────┬───────────────┘
            │          │
     MCP / HTTP /   Context / Device /
       Plugins       Remote gateway
```

这棵树同时解决四件事：

- **发现**：每一级路径都有 `~help`，文档、参数 schema 和当前身份可见面来自运行时本身。
- **调用**：HTTP、CLI、Dashboard 和 `/~mcp` 访问同一套能力与权限模型。
- **治理**：Secret Key 按路径和动作授权，deny 优先；无权路径对调用者表现为不存在。
- **协作**：Agent 可以给具体路径留下使用反馈，也可以把另一套 HTBP 服务联邦成当前树的子树。

## 快速开始：本地运行一个网关

下面使用 Node/Docker 宿主。它把状态存到 SQLite，把对象存到 `/data`，适合先完成一个本地闭环。

### 1. 生成信任根并启动

需要 Node.js 22+ 来生成两个随机值；请保存 Admin SK，丢失后无法从网关中读回。

```sh
export TB_ADMIN_SK="$(node -e "console.log('tbk_'+require('crypto').randomBytes(32).toString('base64url'))")"
export TB_ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"

docker run -d --name tool-bridge \
  -p 127.0.0.1:8787:8787 \
  -v tool-bridge-data:/data \
  -e TB_BOOTSTRAP_ADMIN_SK="$TB_ADMIN_SK" \
  -e TB_SECRET_ENCRYPTION_KEY="$TB_ENCRYPTION_KEY" \
  ghcr.io/tokenrollai/tool-bridge:latest
```

生产部署应通过平台的 Secret 机制注入这两个值，不要把它们写进镜像、仓库或共享脚本。

### 2. 用 CLI 登录、发现和调用

```sh
npm install -g @tool-bridge/cli

tb login --base-url http://127.0.0.1:8787   # 按提示输入刚才保存的 Admin SK
tb tree --depth 2                           # 浏览当前身份可见的树
tb help system/status                      # 阅读节点的实时契约
tb call system/status --tool get           # 调用节点上的 get
```

部署包含 Dashboard，可直接打开 [http://127.0.0.1:8787/ui](http://127.0.0.1:8787/ui)。Dashboard 使用同一套公开 API，SK 只保存在浏览器本地。

不使用 CLI 也可以直接 fetch：

```sh
curl -H "Authorization: Bearer $TB_ADMIN_SK" \
  http://127.0.0.1:8787/~help

curl -X POST \
  -H "Authorization: Bearer $TB_ADMIN_SK" \
  -H "Content-Type: application/json" \
  -d '{"tool":"get","arguments":{}}' \
  http://127.0.0.1:8787/system/status
```

`~help` 默认返回 Markdown；使用 `Accept: text/plain` 可获得紧凑 Help DSL，使用 `Accept: application/json` 可获得包含 JSON Schema 的结构化描述。

## 让 Agent 直接使用 tool-bridge

公开的 [`tool-bridge` Agent Skill](https://github.com/TokenRollAI/tool-bridge-skill) 可以安装到 Codex、Claude Code、Cursor、OpenCode 等兼容 Agent。它不会保存某个实例的静态工具清单，而是让 Agent 从当前网关的 `~search`、`~tree` 与 `~help` 实时发现能力：

```sh
# 安装到本机检测到的 Agent
npx skills add TokenRollAI/tool-bridge-skill

# 或不安装，只使用一次
npx skills use TokenRollAI/tool-bridge-skill@tool-bridge
```

交互使用时先按上面的快速开始运行 `tb login`；自动化环境则通过 Secret 注入 `TB_BASE_URL` 与最小权限 `TB_SK`。不要把 SK 写进 prompt、仓库或命令参数。

安装后直接用自然语言描述目标，例如：

```text
通过 Tool Bridge 找到文档搜索工具，搜索 HTBP 的权限模型，并总结关键约束。
```

Skill 会先验证目标，再搜索或逐级浏览、读取工具级 schema 与已有 feedback，最后按运行时声明调用。遇到错误、超时或结果异常时，Agent 会立即查询该精确路径的 feedback，再决定是否安全重试；已有经验确实有效时及时投票，新问题或已验证解法则在获得 feedback 写入授权后去重提交。`~help` 始终是契约真源，feedback 只是经验层，不能覆盖当前 schema。

## 现在可以怎么用

| 使用方式 | 当前入口 | 典型用途 |
|---|---|---|
| 接入已有工具 | MCP、声明式 HTTP、内置集成、外部 Plugin | 给 Agent 提供统一发现与调用入口 |
| 管理上下文与技能 | R2、S3、Node 文件对象存储、Plugin Context、Skillhub | 统一读写、搜索文档与对象，发布和获取 Agent Skill |
| 接入本地机器 | `tb daemon install`、`tb connect`、SDK `connect()` | 从内网主动连接，按白名单暴露 shell、文件或本地函数 |
| 共享使用经验 | 每个路径的 `~feedback`、CLI、Dashboard | 让后续 Agent 在调用前看到已验证的坑和建议 |
| 联邦多个团队 | remote 节点、`system/federation` | 把另一棵 HTBP 树挂成子树，不共享本地调用者凭据 |
| 兼容 MCP 客户端 | `/<base>/~mcp` | 将当前身份可见的工具投影为 MCP server |

### 接入工具与上下文

先从宿主内置 catalog 选择集成，或直接挂载一个 Streamable HTTP MCP server：

```sh
tb integration catalog --search tavily
tb integration add tools/tavily --provider tavily --key-stdin < tavily.key

tb tool mount tools/docs \
  --kind mcp \
  --url https://mcp.example.com/mcp

tb help tools/docs
tb call tools/docs --tool search --args '{"query":"tool-bridge"}'
```

S3 兼容对象存储可以挂成 Context namespace。凭证只写入 SecretStore，节点记录只保存引用名：

```sh
# s3-credential.json: {"accessKeyId":"...","secretAccessKey":"..."}
tb secret set --name docs-s3 < s3-credential.json
tb ctx mount ctx/docs \
  --provider s3 \
  --endpoint https://s3.example.com \
  --bucket docs \
  --auth-ref docs-s3

tb ctx ls ctx/docs
tb ctx cat ctx/docs notes/readme.md
```

完整参数以 `tb <command> --help` 和 [`packages/cli/README.md`](packages/cli/README.md) 为准。

### 把本地机器接入树

Linux + systemd 上优先用 `tb daemon install`：它会安装用户级服务、启用 login linger、开机
自启并在网络闪断后自动重连，不依赖 SSH 会话。参数与前台 `tb connect` 相同：

```sh
tb daemon install \
  --device-id build-01 \
  --path device/build-01 \
  --allow uname \
  --allow ls \
  --fs ./shared \
  --fs-readonly
```

Shell 默认拒绝所有命令，只有显式 allowlist 中的命令可以执行。用 `tb daemon status`、
`tb daemon logs --follow`、`tb daemon restart` 与 `tb daemon uninstall` 管理本机服务；需要前台
调试时仍可运行同参数的 `tb connect`。远端调用者随后可以通过同一棵树发现
`device/build-01`。长驻容器和 Kubernetes sidecar 示例见
[`packages/cli/CONTAINER.md`](packages/cli/CONTAINER.md)。

## 让 Agent 共享真实使用反馈

反馈不是集中在另一个论坛里，而是附着在具体节点或工具路径上。Agent 在使用前读取经验，踩坑后提交简短建议，再由其他身份投票：

```sh
# 使用前：高分反馈也会直接出现在 tb help <path> 中
tb feedback ls tools/docs

# 使用后：记录可复用的限制或正确姿势
tb feedback submit tools/docs \
  --title "搜索前先确认索引范围" \
  --detail "该上游默认只索引公开文档；私有空间需要单独授权。"

# 其他 Agent 对有帮助的经验投票
tb feedback vote tools/docs <feedback-id> up
```

反馈权限落在目标路径本身：读取需要该路径的 `read`，提交和投票还需要 `call`，删除需要 `admin`。得分靠前的反馈会进入 `~help`，并在启用 Search 的宿主中参与工具搜索，让“实际怎么用”与运行时契约一起被发现。

Dashboard 的节点详情页提供相同的查看、提交、投票和管理能力。

## 联邦多个 tool-bridge

Federation 把另一个 HTBP 服务挂到本地路径下。管理员先开放远端 host，再保存远端专用 SK，最后创建 remote 节点：

```sh
tb federation add tb.team-b.example.com
tb secret set --name team-b-sk < team-b.sk

tb server add teams/team-b \
  --remote-url https://tb.team-b.example.com \
  --sk-ref team-b-sk

tb tree teams/team-b --depth 2
tb help teams/team-b/tools/search
```

联邦默认 fail closed：空 host allowlist 不允许任何远端；只接受 HTTPS（本地开发例外）；本地调用者的 SK 不会发送给远端，出站身份来自 SecretStore 中的 `skRef`。网关还会执行跳数限制、环检测和远端路径校验。

## 部署与嵌入

| 形态 | 状态 / 对象 / 设备 | 副本 | 适合场景 |
|---|---|---|---|
| **Docker 单容器** | SQLite + 本地文件系统 + 进程内 WebSocket | 1 | 自托管、内网、快速验证 |
| **Docker Compose** | PostgreSQL(+ 可选 S3/R2、Redis) | 1–2(单机) | 单机生产、含 HA 参考栈,见 [`deploy/compose/`](deploy/compose/docker-compose.yml) |
| **Kubernetes(Helm)** | PostgreSQL + S3/R2 + Redis → 无状态多副本;或 SQLite + PVC 单副本 | 1–N | 多副本生产、滚动更新,见 [`deploy/helm/tool-bridge/`](deploy/helm/tool-bridge) |
| **Cloudflare Workers** | D1 + R2 + Durable Objects | serverless | 边缘部署、低运维、设备长连接 |
| **嵌入式 SDK** | 由调用方注入 store/provider | — | 在自己的 Node/Workers 应用里注册本地函数 |

Node 宿主的横向扩容公式:**PG(`TB_DATABASE_URL`)+ S3/R2(`TB_OBJECT_STORE_*`)+ Redis(`TB_REDIS_URL`)三件配齐即无状态多副本**;只配前两件是"容器可随意重建、但别扩副本"的单副本无状态形态。Helm chart 会在渲染期直接拒绝危险组合(如 `replicas>1 + SQLite`)。健康探针:`/livez`(liveness)、`/readyz`(readiness,探后端连通 + 优雅关停时提前摘流量)、`/healthz`(版本与 catalog 对拍)。

### Cloudflare Workers

最快入口是页面顶部的 Deploy Button。部署前先生成并保存 `TB_BOOTSTRAP_ADMIN_SK` 与 `TB_SECRET_ENCRYPTION_KEY`，模板会在首次构建前要求填写，避免先启动一个没有信任根的实例。完整说明见 [`template/README.md`](template/README.md)。

从源码 checkout 部署完整形态时，推荐使用 CLI 向导：

```sh
git clone https://github.com/TokenRollAI/tool-bridge
cd tool-bridge
pnpm install
npm install -g @tool-bridge/cli

tb init cloudflare --repo .
```

向导负责登录/选择账户、生成 trust roots、创建 R2/D1、构建部署、验证 `~help` 并保存本机 profile。非交互环境使用 `--account-id <id> --yes`，自定义域使用 `--domain tb.example.com`。

### 嵌入自己的应用

```sh
npm install @tool-bridge/sdk
```

```ts
import { createToolBridge, MemoryStateStore } from '@tool-bridge/sdk'

const tb = createToolBridge({
  state: new MemoryStateStore(),
  adminSk: process.env.TB_BOOTSTRAP_ADMIN_SK!,
})

tb.registerTool('tools/echo', {
  List: () => [{ name: 'echo', description: 'Return the input text' }],
  Call: (_name, args) => ({ content: { echoed: args.text } }),
})

export default { fetch: tb.fetch }
```

Node HTTP server、反向连接和自定义 store 说明见 [`packages/sdk/README.md`](packages/sdk/README.md)。

## 权限与安全边界

- 每个 SK 由 owner、路径 glob 和 `read/write/call/register/admin` 动作组成；deny 优先，无匹配默认拒绝。
- 不可见路径在 `~help`、`~tree` 和调用中返回 404，避免泄露节点是否存在。
- 上游密钥进入只写 SecretStore；节点配置、日志和只读管理响应不返回密钥值。
- 内置 Plugin 与网关同进程同权，并使用受控出站；外部 Plugin 在注册时校验 descriptor 和健康状态。
- 三宿主的权威状态均为强一致后端(Workers=D1、Node=SQLite/PG),SK 吊销即时生效。

签发最小权限 SK 的示例：

```sh
tb sk create \
  --owner agent:researcher \
  --scope 'ctx/docs/**:read' \
  --scope 'tools/search/**:read,call'
```

## 仓库结构

| 路径 | 职责 |
|---|---|
| `packages/core` | 树、授权、协议、store、builtin 等纯逻辑 |
| `packages/app` | 宿主中立的 Hono 应用与 provider 编排 |
| `packages/server` | Node/SQLite/文件/WebSocket 宿主 |
| `packages/gateway` | Cloudflare D1/R2/DO/Assets 宿主 |
| `packages/cli` | `tb` CLI、设备连接与 Cloudflare 初始化 |
| `packages/dashboard` | 使用公开 API 的 Web 管理面 |
| `packages/sdk` | 嵌入式实例、本地 provider 与反向连接 |
| `packages/plugin-sdk` / `packages/plugins` | Plugin 作者契约与内置集成 |
| `llmdoc` | 当前架构、协议契约和可重跑工作流 |

## 开发

要求 Node.js 22+、pnpm 11+。

```sh
pnpm install
pnpm verify              # typecheck + lint + test
pnpm turbo run build     # 修改可发布包、依赖或打包配置时还必须执行
```

本地 Compose 闭环会启动 Node gateway、真实 plugin Worker 和受认证的 mock MCP 上游：

```sh
pnpm compose:up
pnpm compose:smoke
pnpm compose:down
```

代码与生成产物是行为真源。架构边界、协议契约、部署和验证指南从 [`llmdoc/index.md`](llmdoc/index.md) 开始阅读。

## License

[MIT](LICENSE)
