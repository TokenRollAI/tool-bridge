# tool-bridge

简体中文 | [English](README.en.md)

> tool-bridge 是一个**自描述、可反向注册、协议开放的工具与上下文网关**。任何"会 HTTP fetch"的 Agent,凭一个 Secret Key + 一个 BaseURL,即可发现并使用一个组织的全部工具、上下文与设备。

tool-bridge 是 [HTBP](https://github.com/TokenRollAI/HTBP)(HTTP ToolBridge Protocol)的参考实现:核心理念是**能 fetch URL,就能学会用对应的工具**。

```
┌──────────────────────────────────────────────────────┐
│  任意 Agent / CLI / Dashboard(只需 SK + BaseURL)     │  ← GET /~help 渐进发现
├──────────────────────────────────────────────────────┤
│                    tool-bridge                        │
│   HTBP Tree · Tool Layer · Context Layer              │
│   Device Gateway(反向注册) · Auth(SK 作用域)       │
├──────────────────────────────────────────────────────┤
│  上游:MCP server(Streamable HTTP) · HTTP API       │
│  来源:R2 / S3 / File / 自定义 Provider               │
│  设备:任何跑得动 CLI/SDK 的机器(WebSocket 反向接入) │
└──────────────────────────────────────────────────────┘
```

## 为什么需要它

让 Agent 用上"组织里已有的能力"(工具、文档、机器),今天必须逐个打通:

1. **工具接入受限于运行环境**——边缘函数、浏览器、受限 sandbox 里跑不了 MCP client;
2. **上下文碎片化**——知识散落在 R2/S3、文件系统、内部系统里,没有统一读写检索面;
3. **机器能力够不着**——内网服务器的 shell 与文件系统对云上 Agent 完全不可见;
4. **发现即文档**——每接一个工具就要写一份说明,说明与实现总是漂移;
5. **权限缺失**——一把 key 要么全能要么不能,缺少"只能读 `docs/`、只能调 `search/`"的表达。

## 核心主张

- **一棵树,一个入口**:工具、Context、设备全是同一棵 HTBP 树上的节点;Agent 从根 `/~help` 渐进发现一切。
- **自描述**:树上每一级路径都响应 `~help`;`~help` 即文档、即契约、即按权限裁剪后的可见面。
- **上游开放供给**:MCP(Streamable HTTP)、任意 HTTP API、内置能力、其他 HTBP 服务(remote 联邦)都能挂上树;Context 来源支持 R2 / S3 / 自定义 Provider。
- **设备反向注册**:内网机器 `tb connect` 主动建立 WebSocket,把自己的 shell 与 fs 挂上树,云上 Agent 从此够得着任何机器。
- **SK 即权限**:每个 Secret Key 有明确作用域(哪些路径、哪些动作);无权节点对调用者根本不存在。
- **廉价云上运行**:默认 Cloudflare(Workers + Durable Objects + KV + R2),空闲近零成本;同一套核心亦可 Docker 自部署。
- **三入口对等**:Agent(直接 HTTP)、CLI(`tb`)、Dashboard 对同一棵树的操作行为一致,不存在管理旁路。

## 快速开始

### Agent 视角:只需 fetch

```sh
# 从根开始渐进发现(~help 返回面向 LLM 的紧凑 Help DSL,text/plain)
curl -H "Authorization: Bearer $TB_SK" https://your-tb.example.com/~help

# 下钻某个节点
curl -H "Authorization: Bearer $TB_SK" https://your-tb.example.com/tools/echo/~help

# 调用工具
curl -X POST -H "Authorization: Bearer $TB_SK" \
  -d '{"tool":"echo","arguments":{"text":"hi"}}' \
  https://your-tb.example.com/tools/echo
```

### CLI:`tb`

```sh
tb login                    # 保存 BaseURL + SK
tb status --json            # 网关状态
tb tree                     # 树视图
tb call tools/echo --tool echo --args '{"text":"hi"}'
tb connect                  # 把本机 shell/fs 反向注册上树
```

全部子命令支持 `--json`,与 Proto 接口一一对应,覆盖完整管理面。

### SDK:内嵌一个 TB 实例

```ts
import { serve } from '@hono/node-server'
import { createToolBridge, MemoryStateStore } from '@tool-bridge/sdk'

const tb = createToolBridge({ state: new MemoryStateStore() })

tb.registerTool('tools/echo', {
  List: () => [{ name: 'echo', description: '原样返回 text' }],
  Get: () => ({ name: 'echo' }),
  Call: (_name, args) => ({ content: { echoed: args.text } }),
})

serve({ fetch: (req) => tb.fetch(req), port: 8787 })
```

详见 [packages/sdk/README.md](packages/sdk/README.md)。

### 部署到 Cloudflare

```sh
pnpm install
cp .env.example .env        # 填 CLOUDFLARE_ACCOUNT_ID / TB_DOMAIN 等
pnpm verify                 # typecheck + lint + 单测 + 集成测试
pnpm deploy:all             # 幂等 provision(KV/R2)+ 部署 gateway
TB_BASE_URL=https://your-tb.example.com TB_SK=... pnpm smoke
```

完整流程与排错见 `llmdoc/guides/deploy-and-verify.md`。

## 仓库结构(pnpm monorepo)

| 包 | 职责 |
|---|---|
| `packages/core` | 纯逻辑内核:树 / Auth(SK 作用域判定)/ HTBP 编解码 / SecretStore / builtin 模块,无宿主依赖 |
| `packages/gateway` | Cloudflare Workers 网关:Hono 路由 + mcp/http/remote Provider + Durable Object 设备通道 |
| `packages/cli` | `tb` 命令行(citty),纯 API 客户端 |
| `packages/sdk` | `@tool-bridge/sdk`:内嵌 TB 实例、程序化注册、反向连接 |
| `packages/dashboard` | Web 管理面:`~help` 通用渲染器 + 管理表单,无专用后端 |
| `docs/` | 规范真源:Vision / Architecture / Proto / Plugin / Reference |
| `llmdoc/` | 面向 LLM 的压缩检索层文档 |

## 开发

```sh
pnpm verify              # 一把过:typecheck + lint + 全部测试
pnpm test:unit           # core / cli / sdk 单测
pnpm test:integration    # gateway 集成测试(真实 workerd)
pnpm lint:fix            # biome 自动修复
```

工程约定:**实现与文档冲突以 `docs/` 为准**;接口契约唯一规范是 [docs/Proto.md](docs/Proto.md)。

## 项目状态

积极开发中(pre-release)。核心链路——SK 鉴权、HTBP 树、mcp/http/remote 工具层、Context 四动词 + `$ref` 大对象、设备反向注册(WS hibernation)——已在 Cloudflare 生产环境验证;SDK / Plugin 与 Dashboard、Docker 自部署路径正在推进。

## License

[MIT](LICENSE)
