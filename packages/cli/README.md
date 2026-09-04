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

需要让 Agent 无确认地执行只读诊断时，不要降低 `shell/exec` 的危险等级。改用结构化命令
profile，并关闭 arbitrary shell：

```sh
tb daemon install \
  --device-id build-01 \
  --path device/build-01 \
  --no-shell \
  --command-profile ./packages/cli/examples/structured-command-profile.json
```

profile 是 strict JSON，完整示例见
[`examples/structured-command-profile.json`](./examples/structured-command-profile.json)。每个文件定义
一个相对设备路径和若干命令；每条命令必须声明 `executable`、`effect` 与描述，`argv` 由固定字符串和
受类型约束的输入槽组成。输入槽支持 `string` / `number` / `boolean`、`choices`、`required`、
`multiple` 与固定 `flag`。执行始终使用 `spawn(executable, argv, {shell:false})`；只有 profile 明确把
shell 本身写成 executable 时才会进入 shell。

可选的 `cwd`、`timeoutMs`、`maxOutputBytes` 与 `inheritEnv` 也是逐命令策略。子进程缺省只继承
PATH、locale、HOME、USER 等非凭证基础环境；`inheritEnv` 只记录变量名并在执行时取值。它不是
SecretStore 注入，也不提供输出脱敏，因此不要用它传 token、SK 或密码。`effect:'destructive'` 始终
强制 `confirm:true`。结果除兼容的 stdout/stderr/exitCode 外，还包含起止时间、
`outcome`、signal 与两条输出流的截断标记。

逐命令可选 `delivery:'mailbox'|'both'`：`mailbox` 只接受持久化交付，`both` 同时接受实时调用；
不填保持 realtime。调用仍统一使用 `tb call <完整命令路径>`：`--delivery mailbox` 直接入队，
`--delivery fallback` 先尝试 realtime，只在网关确认尚未 dispatch 时安全入队。发送后的断线或
超时不会再次入队。设备侧消费需要 SDK 的 durable journal；一个 deviceId 同时运行多个安装不在
当前幂等保证内。

`tb connect` 支持同一个可重复的 `--command-profile` 参数。`tb daemon install` 会把已经校验和
规范化的 profile 冻结到 `0600` daemon 配置，后续重启不再读取原文件。

```sh
tb sk create \
  --owner device:build-01 \
  --scope 'device/build-01/**:register' \
  --register-path device/build-01
```

## 常用命令

| 命令 | 用途 |
|---|---|
| `tb login` / `tb whoami` / `tb use` | 档案管理(多网关/多 SK 切换) |
| `tb ls` / `tb tree` / `tb help <path>` | 浏览工具树与节点文档 |
| `tb call <path>/<command> '{…}'` | 调用任意命令；设备命令可用 `--delivery mailbox\|fallback` |
| `tb tool mount/rm` · `tb server add/ls/rm` | 挂载 HTTP/MCP/plugin 上游与远端 HTBP 服务 |
| `tb store upload/ls/stat/get/share/revoke-share/rm` | 管理部署级 default Store；设备产物不需要 Context 挂载 |
| `tb ctx ls/cat/put/upload/patch/rm/search` | 上下文读写；`upload` 通过限时 PUT 直传二进制 |
| `tb sk` / `tb secret` | SK 签发/查看/更新/禁用/吊销与上游凭证管理 |
| `tb connect` | 将本机注册为设备(shell/fs/结构化命令反向通道) |
| `tb daemon install/status/logs/restart/uninstall` | 在 Linux 上持久运行本机设备连接 |
| `tb device ls` | 设备清单 |
| `tb device op ls/get/cancel` | 持久化设备操作的查询与取消；创建统一走 `tb call --delivery` |
| `tb skill ls/get/search/publish/rm/mount/unmount` | Agent Skill 仓库 |
| `tb federation` / `tb note` / `tb feedback` | 联邦白名单、路径注解与使用反馈 |
| `tb plugin register/list/get/update/health/rm` | 插件注册表与探活 |

`tb ctx put` 面向可内联的文本/JSON，支持 stdin 与 `--meta`；`tb ctx upload` 面向大文件或
二进制，先申请短期 PUT 后直传对象存储。`upload` 缺省拒绝覆盖同名 entry，确认替换时显式加
`--force`。

`tb store upload` 则把普通附件、设备照片/视频等写入每个部署必备的 default Store，返回稳定的
`store://default/...` URI；它不要求也不创建 Context。`tb store share` 的成功 stdout/JSON 会返回
用户明确请求的短期 bearer `$ref`，stderr 与错误响应不会打印该链接。大文件上传、下载均流式执行。

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

## 自托管安装、配置与维护

默认从 Dashboard 的 `/ui/setup` 完成安装。CLI 对等入口如下；配对凭证来自部署主机本地命令，不是长期 Admin SK：

```sh
# 在部署主机生成短效配对凭证（目录对应服务的 bootstrap 卷）
umask 077
tb setup pair --directory /data/bootstrap > pairing-token

# 内置 PostgreSQL/S3 凭证由安装器管理，输入空对象即可使用内置服务
printf '{}' | tb setup configure --base-url http://127.0.0.1:8787 --token-file ./pairing-token --file -
```

安装完成响应中的管理员密钥只用于此次交付，请保存后用 `tb login` 建立档案。Compose 部署使用
`docker compose exec -T app node /app/dist/admin.js pair` 生成配对凭证。

| 能力 | CLI |
|---|---|
| 配置字段与实际生效状态 | `tb config schema/get/status` |
| 校验与保存运行设置 | `tb config validate --file settings.json`；`tb config update --revision <当前版本> --file settings.json` |
| 应用已保存设置 | `tb config apply --revision <已保存版本>` |
| 存储后端与实际能力验证 | `tb storage list/get`；`tb storage add --file backend.json`；`tb storage test <id> --revision <版本>` |
| 切换新上传目标 | `tb storage activate <id> --revision <后端版本> --active-revision <默认指针版本>` |
| 轮换存储凭证 | `tb storage update <id> --revision <版本> --file credential.json` |
| 删除无引用后端 | `tb storage rm <id> --revision <版本>` |
| 读取与提交部署设置 | `tb deployment get/status/schema`；`tb deployment update --revision <版本> --file deployment.json` |
| 启动受限本机执行器 | `tb deployment agent --compose ./docker-compose.yml` |
| 数据库/Redis 维护状态 | `tb maintenance status` |
| 迁移至空 PostgreSQL | `tb maintenance database --revision <版本> --instance-id <实例ID> --file database.json` |
| 数据库凭证轮换 | `tb maintenance rotate-database-credentials --revision <版本> --instance-id <实例ID> --file credential.json` |
| 更换或停用 Redis | `tb maintenance redis --revision <版本> --file redis.json`（停用使用 `{"redisUrl":null}`） |
| 密钥状态与轮换 | `tb keys status`；`tb keys rotate --target encryption\|signing --revision <版本>` |
| 继续有界重加密任务 | `tb keys resume <job-id>` |
| 退役无引用的旧根 | `tb keys retire <key-id> --target encryption\|signing --revision <版本>` |
| 导出恢复密钥备份 | `tb keys backup --out ./key-backup.json`（新建 `0600` 文件，绝不打印密钥） |

运行设置文件只包含 `tb config get` 响应的 `desired` 字段。保存后检查新 revision，再显式 apply。
存储后端文件为 `{name,connection:{endpoint,bucket,region?,accessKeyId,secretAccessKey}}`；凭证轮换文件
为 `{accessKeyId,secretAccessKey}`。密码与完整数据库/Redis URL 只从文件或 stdin 读取，不能放到 argv。
数据库登录轮换文件可额外提供 `databaseAdminUrl`，仅用于本次角色切换；内置数据库自动使用受保护的管理凭证。

部署执行器只更新显式选择的 Compose 文件中的 `app` 服务，使用固定镜像、端口和挂载操作。
新数据目录必须为空且位于 Compose 文件目录下；执行器会停止应用、复制原 bootstrap、恢复私有权限，
然后重建并验证实例身份。健康检查失败会恢复旧 Compose。UI 挂载目录必须包含 `index.html` 与 `assets`。

已初始化实例的恢复使用独立配对模式与 HTTP 入口，不会重新创建管理员：

```sh
tb setup pair --recovery --directory /data/bootstrap > recovery-token
tb setup recover --base-url http://127.0.0.1:8787 --token-file recovery-token \
  --file recovery-connections.json --backup-file key-backup.json
```

根文件完好时可省略 `--backup-file`。恢复会核对备份与当前实例身份；普通 `setup configure` 不接受备份。
