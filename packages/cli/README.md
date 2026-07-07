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
tb call docs/context7 resolve-library-id --args '{"query":"react"}'
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `tb login` / `tb whoami` / `tb use` | 档案管理(多网关/多 SK 切换) |
| `tb ls` / `tb tree` / `tb help <path>` | 浏览工具树与节点文档 |
| `tb call <path> <tool>` | 调用任意已挂载工具 |
| `tb tool mount/rm` · `tb server add/ls/rm` | 挂载 HTTP/MCP 上游 |
| `tb ctx ls/cat/put/patch/search` | 上下文(对象存储)读写 |
| `tb sk` / `tb secret` | SK 签发/吊销与上游凭证管理 |
| `tb connect` | 将本机注册为设备(shell/fs 反向通道) |
| `tb device ls` | 设备清单 |

全局 `--json` 输出机器可读结果。配置存于 `~/.config/tool-bridge/config.json`。

## 要求

Node.js >= 22。

## License

MIT
