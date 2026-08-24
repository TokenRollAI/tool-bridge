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
tb call docs/context7/resolve-library-id --args '{"query":"react"}'
```

## 把 Linux 机器作为 daemon 接入

Linux + systemd 上不需要手写 unit。先用一把只允许注册该设备路径的 Device SK 建立独立
profile，再一条命令安装用户级服务：

```sh
tb login --profile device --base-url https://your-gateway.example.com

tb daemon install \
  --device-id build-01 \
  --path device/build-01 \
  --allow git \
  --allow npm
```

安装命令会冻结当前解析出的网关、SK 与 expose 参数到 `0600` 私有配置，生成 systemd user
unit、启用 login linger、立即启动，并等待设备真正连接成功。unit 与进程参数中不包含 SK；以后执行
`tb use` 切换交互 profile 也不会改变已安装 daemon 的目标。

```sh
tb daemon status
tb daemon logs --follow
tb daemon restart
tb daemon uninstall
```

`uninstall` 只移除本机服务和 daemon 配置，不删除登录 profile，也不吊销服务端 SK。安装与管理
命令应以目标 Linux 用户运行，不要使用 `sudo tb daemon ...`；首次启用 linger 若需要管理员授权，CLI
只会为固定的 `loginctl enable-linger` 操作请求 sudo。

Shell 缺省仍然拒绝所有命令。`--allow '*'` 会把任意 shell 命令开放给有该路径 `call` 权限的
身份，实际系统权限等于运行 daemon 的 Linux 用户；交互安装会二次确认，非交互安装还必须显式
传 `--yes`。daemon 配置可被同一用户读取，因此只能使用最小权限 Device SK，绝不能复用 Admin
SK。Device SK 的注册权限应类似：

```sh
tb sk create \
  --owner device:build-01 \
  --scope 'device/build-01/**:register' \
  --register-path device/build-01
```

从 tool-bridge 源码仓库首次部署到 Cloudflare，可直接运行：

```sh
git clone https://github.com/TokenRollAI/tool-bridge && cd tool-bridge
pnpm install
tb init cloudflare --repo .
```

向导会登录/选择 Cloudflare 账户、生成并注入 Admin SK 与 SecretStore 主密钥、幂等创建
KV/R2/D1、构建部署、验证 `~help`，最后保存本机 profile。Admin SK 只显示一次；请立即存入
密码管理器。CI 使用 `--account-id <id> --yes`，自定义域使用 `--domain tb.example.com`。
发现同名 Worker 时，向导必须先用对应 `--profile` 验证成功，且不会覆盖既有 Admin SK。

## 常用命令

| 命令 | 用途 |
|---|---|
| `tb init cloudflare` | 从源码仓库初始化、部署并验证 Cloudflare Worker |
| `tb login` / `tb whoami` / `tb use` | 档案管理(多网关/多 SK 切换) |
| `tb ls` / `tb tree` / `tb help <path>` | 浏览工具树与节点文档 |
| `tb call <path>/<command> '{…}'` | 调用任意已挂载工具/命令(直连,body 即 arguments) |
| `tb tool mount/rm` · `tb server add/ls/rm` | 挂载 HTTP/MCP/plugin 上游与远端 HTBP 服务 |
| `tb ctx ls/cat/put/upload/patch/rm/search` | 上下文读写；`upload` 通过限时 PUT 直传二进制 |
| `tb sk` / `tb secret` | SK 签发/查看/更新/禁用/吊销与上游凭证管理 |
| `tb connect` | 将本机注册为设备(shell/fs 反向通道) |
| `tb daemon install/status/logs/restart/uninstall` | 在 Linux 上持久运行本机设备连接 |
| `tb device ls` | 设备清单 |
| `tb skill ls/get/search/publish/rm/mount/unmount` | Agent Skill 仓库 |
| `tb federation` / `tb note` / `tb feedback` | 联邦白名单、路径注解与使用反馈 |
| `tb plugin register/list/get/update/health/rm` | 插件注册表与探活 |

`tb ctx put` 面向可内联的文本/JSON，支持 stdin 与 `--meta`；`tb ctx upload` 面向大文件或
二进制，先申请短期 PUT 后直传对象存储。`upload` 缺省拒绝覆盖同名 entry，确认替换时显式加
`--force`。

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
