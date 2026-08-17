# @tool-bridge/cli

`tb` — Tool Bridge 的命令行客户端:用一个网关统一访问 HTBP/MCP/HTTP 工具、上下文存储与设备 shell。

## 安装

```sh
npm install -g @tool-bridge/cli
# 或
pnpm add -g @tool-bridge/cli
```

也可以把全部 `tb` 子命令编译进一个 Bun 独立二进制，不需要在目标机器安装 Node.js：

```sh
pnpm --filter @tool-bridge/cli build
pnpm --filter @tool-bridge/cli build:binary
./packages/cli/binary/tb --version
./packages/cli/binary/tb tree --base-url https://your-gateway.example.com --sk "$TB_SK"
```

该命令默认编译当前宿主平台。Linux amd64/arm64 的可复现构建见仓库根目录
[`Dockerfile.cli`](../../Dockerfile.cli)。

## 完整 CLI 镜像

镜像入口就是完整的 `tb`，并非仅包含 Device 命令：

正式发布镜像为 `ghcr.io/tokenrollai/tool-bridge-cli:<version>`；一次性命令、配置持久化、Device
守护、Kubernetes Sidecar 和二进制抽取方式见独立的
[`CONTAINER.md`](./CONTAINER.md)。

```sh
docker build -f Dockerfile.cli -t tb-cli:local .

docker run --rm tb-cli:local --version
docker run --rm \
  -e TB_BASE_URL=https://your-gateway.example.com \
  -e TB_SK="$TB_SK" \
  tb-cli:local tree --depth 2
```

需要持久化 `tb login` 的 profile 时，把配置目录挂到容器的 `/home/tb/.config`：

```sh
docker volume create tb-cli-config
docker run --rm -it -v tb-cli-config:/home/tb/.config \
  tb-cli:local login --base-url https://your-gateway.example.com --sk "$TB_SK"
docker run --rm -v tb-cli-config:/home/tb/.config tb-cli:local status --json
```

`tb connect` 本身保持前台运行，内部使用 WebSocket 心跳和自动重连；守护与崩溃拉起交给容器运行时：

```sh
docker run -d --name tb-device --restart unless-stopped \
  -e TB_BASE_URL=https://your-gateway.example.com \
  -e TB_SK="$TB_SK" \
  -v "$PWD/shared:/workspace:ro" \
  tb-cli:local connect \
    --device-id build-01 \
    --path device/build-01 \
    --allow uname \
    --fs /workspace --fs-readonly
```

Kubernetes 可将同一镜像作为普通 sidecar 运行；Pod 负责异常退出后的重启，CLI 负责网络闪断后的
原连接重建。可直接改造的清单见
[`examples/kubernetes-sidecar.yaml`](./examples/kubernetes-sidecar.yaml)。生产环境建议给每个 Pod 使用
唯一 `--device-id` / `--path`（例如 Pod UID），并使用最小权限 SK、shell 白名单和只读文件挂载。

构建并推送 amd64 + arm64 镜像：

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.cli -t ghcr.io/tokenrollai/tool-bridge-cli:0.14.0 --push .
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

## npm 安装要求

Node.js >= 22。

## License

MIT
