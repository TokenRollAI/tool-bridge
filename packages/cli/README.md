# @tool-bridge/cli

`tb` — Tool Bridge 的命令行客户端:用一个网关统一访问 HTBP/MCP/HTTP 工具、上下文存储与设备 shell。

## 安装

```sh
npm install -g @tool-bridge/cli
# 或
pnpm add -g @tool-bridge/cli
```

## 快速开始

```sh
tb login --base-url https://your-gateway.example.com   # 交互输入 SK
tb status            # 网关健康与版本
tb tree              # 浏览可见的工具树
tb help docs/context7            # 节点级 ~help(工具索引)
tb call docs/context7 --tool resolve-library-id --args '{"query":"react"}'
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `tb login` / `tb whoami` / `tb use` | 档案管理(多网关/多 SK 切换) |
| `tb ls` / `tb tree` / `tb help <path>` | 浏览工具树与节点文档 |
| `tb call <path> --tool <tool>` / `tb call <tool-path> '{…}'` | 调用任意已挂载工具 |
| `tb tool mount/rm` · `tb server add/ls/rm` | 挂载 HTTP/MCP/plugin 上游与远端 HTBP 服务 |
| `tb ctx ls/cat/put/patch/rm/search` | 上下文(对象存储)读写 |
| `tb sk` / `tb secret` | SK 签发/查看/更新/禁用/吊销与上游凭证管理 |
| `tb connect` | 将本机注册为设备(shell/fs 反向通道) |
| `tb device ls` | 设备清单 |
| `tb skill ls/get/search/publish/rm/mount/unmount` | Agent Skill 仓库 |
| `tb federation` / `tb note` / `tb feedback` | 联邦白名单、路径注解与使用反馈 |
| `tb plugin register/list/get/update/health/rm` | 插件注册表与探活 |

全局参数 `--json` / `--base-url` / `--sk` / `--timeout` 可放在命令前、中、后任一层级；
即使 Commander 在业务 action 前报错，`--json` 也会返回单个可解析错误对象。配置存于
`~/.config/tool-bridge/config.json`。`--timeout` 是 HTTP 单请求上限；长驻的 `connect` /
`mount fs` 会明确拒绝该参数，避免制造“连接总时长”的错误预期。

列表和搜索命令统一使用 `--limit <1..200>` 与 `--cursor <opaque-cursor>`：

```sh
tb --json sk list --limit 50
tb plugin list --cursor '<previous cursor>' --json
```

挂载远端 HTBP 服务时，`--base-url` 始终表示 CLI 当前访问的网关，远端地址使用
`--remote-url`：

```sh
tb server add fed/team-b --remote-url https://team-b.example.com
```

这是对旧 `tb server add ... --base-url <remote>` 写法的迁移；旧写法会明确提示缺少
`--remote-url`，不会再把同一个参数解释成两种地址。

## 要求

Node.js >= 22。

## License

MIT
