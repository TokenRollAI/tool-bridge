<div align="center">

<img src="tool-bridge.png" alt="tool-bridge" width="160" />

# tool-bridge

**把工具、上下文、设备和远端服务组织成一棵带权限的、自描述的 HTTP 树。**

Agent 只需要一个 BaseURL 和一个 Secret Key，就能发现能力、阅读契约并发起调用；不要求安装特定 SDK，也不要求运行 MCP client。

简体中文 | [English](README.en.md) | [在线文档](https://tool-bridge.tokenroll.ai/)

[![npm: cli](https://img.shields.io/npm/v/@tool-bridge/cli?label=%40tool-bridge%2Fcli)](https://www.npmjs.com/package/@tool-bridge/cli)
[![npm: sdk](https://img.shields.io/npm/v/@tool-bridge/sdk?label=%40tool-bridge%2Fsdk)](https://www.npmjs.com/package/@tool-bridge/sdk)
[![Railway](https://img.shields.io/badge/Railway-Quick_Deploy-0B0D0E?logo=railway)](#railway)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)


</div>

> [!IMPORTANT]
> tool-bridge 目前处于 **pre-launch** 开发阶段。Node/Docker、SDK、CLI 和 Dashboard 已能组成完整使用闭环，但项目尚无正式生产环境，也暂不承诺稳定性 SLA。现在适合自托管试用、内部集成和参与开发；升级前请阅读发布说明并保留数据备份。

**使用导航：** [快速开始](#快速开始本地运行一个网关) · [浏览器 Dashboard](#浏览器-dashboard) · [手机 App](#手机-app) · [Agent 接入](#让-agent-直接使用-tool-bridge) · [使用场景](#现在可以怎么用) · [部署](#部署与嵌入)

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

默认 Docker Compose 栈使用 GHCR 预构建应用镜像，包含 PostgreSQL 和 S3 兼容对象存储。只需安装 Docker（含 Compose）并下载一份 Compose 文件，无需克隆源码或本地构建；安装器会自动生成基础设施凭证。

### 1. 启动并配对实例

```sh
mkdir -p tool-bridge
cd tool-bridge
curl -fsSL https://raw.githubusercontent.com/TokenRollAI/tool-bridge/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
docker compose exec -T app node /app/dist/admin.js pair
```

打开 [http://127.0.0.1:8787/ui/setup](http://127.0.0.1:8787/ui/setup)，输入一次性配对凭证，使用内置数据库和对象存储完成安装。将安装成功后显示的 Admin SK 保存到密码管理器，后续登录时使用。PostgreSQL、对象存储和 bootstrap 身份/密钥分别保存在 Docker 持久卷中。

希望直接托管到云上？跳到 [Railway 快速部署](#railway)。

需要从源码构建时，克隆本仓库并在仓库根目录运行：

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

根目录与 [`deploy/compose/docker-compose.yml`](deploy/compose/docker-compose.yml) 均默认使用固定版本的 GHCR 镜像；源码构建需要显式叠加 [`docker-compose.build.yml`](docker-compose.build.yml)。

### 2. 用 CLI 登录、发现和调用

```sh
npm install -g @tool-bridge/cli

tb login --base-url http://127.0.0.1:8787   # 按提示输入刚才保存的 Admin SK
tb tree --depth 2                           # 浏览当前身份可见的树
tb help system/status                      # 阅读节点的实时契约
tb call system/status/get                  # 调用节点上的 get 命令
```

部署包含 Dashboard，可直接打开 [http://127.0.0.1:8787/ui](http://127.0.0.1:8787/ui)。Dashboard 使用同一套公开 API，SK 只保存在浏览器本地。

不使用 CLI 也可以直接 fetch：先把保存的 Admin SK 读入临时变量（Bash）：

```bash
read -rsp "Admin SK: " TB_ADMIN_SK; echo

curl -H "Authorization: Bearer $TB_ADMIN_SK" \
  http://127.0.0.1:8787/~help

curl -X POST \
  -H "Authorization: Bearer $TB_ADMIN_SK" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://127.0.0.1:8787/system/status/get
```

`~help` 默认返回 Markdown；使用 `Accept: text/plain` 可获得紧凑 Help DSL，使用 `Accept: application/json` 可获得包含 JSON Schema 的结构化描述。

## 浏览器 Dashboard

安装网关后，打开 `<网关地址>/ui` 即可使用，无需单独安装桌面客户端。Dashboard 与 `tb` CLI 使用同一套权限：当前 SK 看不到的工具，也不会因为进入浏览器就变得可见。

![浏览器能力树：从网关根目录展开设备分支，浏览已接入的电脑和手机](docs/screenshots/dashboard-capability-tree.png)

### 连接你的网关

1. 打开自己部署的 Dashboard，例如 `http://127.0.0.1:8787/ui`。
2. 使用当前网关时，保留同源连接；连接另一套实例时，填写「其他网关地址」，例如 `https://gateway.example.com`，不带 `/ui`。
3. 输入访问密钥（Secret Key），为连接填写易辨认的档案名，再点击「连接工作区」。连接成功后进入工作台。

<details>
<summary>查看浏览器连接页</summary>

![浏览器 Dashboard 连接页：选择网关、输入访问密钥并保存连接档案](docs/screenshots/dashboard-login.png)

</details>

连接档案和 SK 保存在当前浏览器，请在受信任设备上使用。收藏与最近使用也只属于本机的当前连接，不会同步到其他浏览器；最近使用保留工具入口，不保存调用参数和结果。

### 找到工具，完成第一次调用

1. 进入「工具」逐级浏览，或使用顶部搜索（`⌘K` / `Ctrl+K`）查找命令。
2. 打开命令，阅读说明与参数要求，填写表单后点击「调用」，在页面中查看响应和耗时。
3. 展开「等价 CLI / curl」，把同一次调用迁移到终端或脚本；点击收藏，下次从工作台直接进入。

刚安装的实例可以先打开 `system/status` 下的 `get` 命令，读取网关状态。对应的 CLI 操作是：

```sh
tb help system/status
tb call system/status/get
```

### 添加工具、浏览能力树与管理设备

| 想做什么 | Dashboard 操作 |
|---|---|
| 接入第三方工具 | 点击「添加工具」，选择内置集成、MCP Server 或 HTTP 端点，按向导填写配置；需要 OAuth 的集成还需完成授权 |
| 查看工具之间的层级关系 | 打开「能力树」，展开目录，选中节点查看说明和命令 |
| 查看电脑或手机是否连接 | 打开「设备」查看设备状态；「连接设备」提供接入引导 |
| 上传、下载或分享附件 | 在「文件存储」中上传文件、复制稳定 URI，或创建短期分享 |
| 给 Agent 分配访问范围 | 在「访问密钥」中签发按路径和动作限制的 SK；第三方服务的上游凭证在「服务凭证」中管理 |

![浏览器设备页：集中查看两台 Linux 电脑和一台手机的会话状态，并进入各设备工具](docs/screenshots/dashboard-devices.png)

以上浏览器截图来自一个已配置的实例；你的目录、设备和可见操作取决于实际接入内容与当前 SK 权限。

设备离线后仍可能保留在能力树中。是否可以调用、是否支持延迟交付，要以命令当前声明的能力和设备状态为准，详见[离线设备交付](#给暂时离线的设备延迟交付)。

## 手机 App

**[App 源码仓库](https://github.com/TokenRollAI/tool-bridge-mobile) · [下载 Android 预览版 APK](https://github.com/TokenRollAI/tool-bridge-mobile/releases)**

在 Releases 中选择所需版本，从 Assets 下载 `.apk` 安装包；平台支持和安装说明以 App 仓库及对应发布说明为准。

手机端把「查看 Agent 发来的内容」和「管理这台设备」放在两个页签中。下面是实际使用截图：左侧是信箱，右侧是设备连接与授权状态。

<table>
  <tr>
    <th>信箱：集中查看报告与消息</th>
    <th>设备：确认连接与授权状态</th>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/mobile-inbox.jpg" alt="手机 App 信箱页，展示日报消息、搜索框和全部／未读筛选" width="300" /></td>
    <td align="center"><img src="docs/screenshots/mobile-device.jpg" alt="手机 App 设备页，展示设备 ID、已连接网关以及连接配置和授权与安全入口" width="300" /></td>
  </tr>
</table>

### 查看 Agent 报告

进入「信箱」，从消息标题和摘要浏览 Agent 发来的日报、更新汇总等内容；用搜索框查找消息，或切换「未读」筛选待处理内容。截图展示了版本动态与每日资讯报告：可以把不同 Agent 的产出集中到一个阅读入口。

### 确认手机连接与授权

1. 进入「设备」，查看当前设备 ID 和网关连接状态。设备 ID 用于让 Agent 识别这台手机。
2. 通过「连接配置」检查连接目标。手机需要能访问该网关；手机上的 `127.0.0.1` 指向手机自身，不能用它连接电脑上运行的网关。
3. 在「授权与安全」中检查调用模式。截图中的「直接调用」已开启，这是该设备当时的设置；系统权限与设备限制仍然有效，也可以紧急停用。
4. 回到浏览器的「设备」页确认设备状态，让 Agent 通过实时 `~help` 发现该设备实际开放的命令。

手机 App 的「信箱」是面向人的消息阅读界面；下文的 **Durable Mailbox** 是网关为设备命令提供的持久化执行账本。两者用途不同，Mailbox 本身也不会唤醒被系统停止的 App。

截图中的网关地址、设备 ID 和消息仅用于展示，请使用自己的连接配置。

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
| 存储设备产物和附件 | 部署自带的 default Store、SDK、CLI、Dashboard | 上传照片/视频/录音，获得稳定 URI，并按需短期分享 |
| 管理上下文与技能 | S3、设备文件对象存储、Plugin Context、Skillhub | 统一读写、搜索文档与对象，发布和获取 Agent Skill |
| 接入本地机器 | `tb daemon install`、`tb connect`、SDK `connect()` | 从内网主动连接，按白名单暴露 shell、文件或本地函数 |
| 共享使用经验 | 每个路径的 `~feedback`、CLI、Dashboard | 让后续 Agent 在调用前看到已验证的坑和建议 |
| 联邦多个团队 | remote 节点、`system/federation` | 把另一棵 HTBP 树挂成子树，不共享本地调用者凭据 |
| 兼容 MCP 客户端 | `/<base>/~mcp` | 将当前身份可见的工具投影为 MCP server |

### 让 Agent 检查手机与 Linux 设备

接入设备、完成 `tb login` 并安装 Agent Skill 后，可以直接提出这样的请求：

```text
使用 tb CLI 告诉我现在的设备状态。
看看我的两台 Linux 设备的运行情况，只做只读检查，汇总负载、内存、磁盘和异常服务。
```

Agent 先发现设备与命令，再按当前设备开放的能力读取状态。你也可以从终端开始：

```sh
tb device ls
tb tree device --depth 2
# 将 <设备路径> 替换为上一步返回的实际路径
tb help <设备路径>
```

下面是两次实际对话截图：第一张汇总电脑和手机的在线状态，并读取手机电量、网络与运行状态；第二张对比两台 Linux 的资源使用和异常服务。具体结果来自截图当时的设备状态，不代表默认安装就开放这些命令。

![Agent 通过 tb CLI 查询电脑和 Android 手机状态，汇总在线状态、电量与网络](docs/screenshots/agent-device-status.png)

<details>
<summary>展开查看：两台 Linux 设备的只读巡检</summary>

![Agent 对比两台 Linux 设备的负载、内存、磁盘和异常服务，并给出待检查项](docs/screenshots/agent-linux-inspection.png)

</details>

Linux 巡检示例使用设备已授权的 `shell/exec`；新接入设备的 shell 默认拒绝所有命令，需要明确 allowlist，也可以使用结构化命令 profile 暴露固定诊断能力。手机命令以 App 实际声明、系统权限和设备授权为准；Agent 应读取实时 `~help`，不能从截图猜测命令路径。

### 上传设备产物与普通附件

每个标准部署都自带一个与 Context 独立的 default Store，通过 S3 兼容服务存储对象。
设备拍照、视频和录音不需要先挂载 Context：

```sh
tb store upload ./capture.jpg --json
tb store ls
tb store stat store://default/<objectId>
tb store get store://default/<objectId> --out ./capture.jpg
tb store share store://default/<objectId> --ttl 3600 --json
tb store revoke-share <shareId>
```

`store://default/...` 是稳定标识，本身不授予读取权限。`share` 返回的 `$ref` 是短期 bearer，
只会在这次成功命令的 stdout/JSON 中出现；不要写入日志。Context upload 仍用于“把二进制写到某个
语义 Context 的命名 entry”，与 Store 的匿名设备产物用途不同。

### 接入工具与上下文

先从宿主内置 catalog 选择集成，或直接挂载一个 Streamable HTTP MCP server：

```sh
tb integration catalog --search tavily
tb integration add tools/tavily --provider tavily --key-stdin < tavily.key

tb tool mount tools/docs \
  --kind mcp \
  --url https://mcp.example.com/mcp

tb help tools/docs
tb call tools/docs/search --args '{"query":"tool-bridge"}'
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
tb ctx upload ctx/docs photos/shot.jpg --file ./shot.jpg
# 只有确认需要替换已有对象时才加 --force
# tb ctx upload ctx/docs photos/shot.jpg --file ./shot.jpg --force
```

`ctx upload` 先向 namespace 的 `create_upload` 申请定路径、限时的 presigned PUT，再把
文件二进制直接发送到对象存储；网关只看到 `{path, contentType, overwrite?}`。缺省上传会用
条件 PUT 拒绝覆盖同名对象，只有 CLI `--force` 或 Dashboard 二次确认才允许替换。
命令输出的是可长期保存的 `node://...` URI，不会打印临时上传
URL。从 Dashboard 直传时还要为 Dashboard origin 配置 bucket CORS。

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

只读诊断不必经过 arbitrary shell。`--command-profile <file>` 可以把固定 executable、无隐式 shell
的 argv 模板、输入 schema 和显式 `effect/confirm` 暴露为结构化设备命令；配合 `--no-shell` 可完全
移除 shell 节点。格式与安全边界见
[`packages/cli/examples/structured-command-profile.json`](packages/cli/examples/structured-command-profile.json)
和 [`packages/cli/README.md`](packages/cli/README.md)。

### 给暂时离线的设备延迟交付

结构化设备命令可以在 profile 中声明 `"delivery": "mailbox"`（仅入队）或
`"delivery": "both"`（实时调用与 Mailbox 都支持）；不声明仍是原来的 realtime 行为。调用方仍然
只调用完整命令路径，通过同一次 invoke 的 delivery 策略选择直接入队，或先实时、确定未 dispatch
时再安全 fallback：

```sh
tb call device/build-01/ops/system/system-info \
  --args '{}' \
  --delivery fallback \
  --idempotency-key inspect-build-01-20260828 \
  --ttl 3600

tb device op ls build-01
tb device op get build-01 <operation-id>
tb device op cancel build-01 <operation-id>
```

Mailbox 是 pull-only 的持久化执行账本：网关先落库，设备用
`@tool-bridge/sdk/device` 主动 claim / renew / complete；它不会用 APNs、FCM 唤醒设备。fallback
只在网关确认 realtime 尚未 dispatch 时入队；发送后的断线/超时属于执行歧义，不会再次入队。
Mailbox 使用安装时生成并持久保存在 bootstrap 中的加密根；参数与结果使用
独立 HKDF 子密钥做静态加密，但不是端到端加密，网关在授权后的 claim/complete 路径仍会处理明文。

`result_unknown` 表示设备确认已经开始执行但结果无法恢复；claimed 操作过期则为 `expired` 且标记
“可能已执行”。两者都不能在没有业务幂等保障时盲目重试。MVP 的执行幂等依赖设备安装本地的持久
journal，并以一个 deviceId 只有一个活跃安装为前提。

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

| 形态 | 状态 / 对象 | 副本 | 适合场景 |
|---|---|---|---|
| **Docker Compose** | PostgreSQL + S3 + bootstrap 持久卷 | 默认 1 | 本地试用、自托管，见 [`docker-compose.yml`](docker-compose.yml) |
| **Railway** | PostgreSQL + S3 + `/data` 持久卷 | 1 | 云上托管，见[下方快速部署](#railway) |
| **Kubernetes（Helm）** | PostgreSQL + S3 + bootstrap 持久化；多副本另配 Redis | 1–N | 集群部署，见 [`deploy/helm/tool-bridge/`](deploy/helm/tool-bridge) |
| **嵌入式 SDK** | 由调用方注入 store/provider | — | 在自己的 Node 应用里注册本地函数 |

PostgreSQL 保存权威状态，S3 保存对象字节；bootstrap 中的实例身份和密钥也必须持久保存。业务配置通过安装流程及 API/CLI/Dashboard 管理，不再使用旧的 `TB_DATABASE_URL` / `TB_OBJECT_STORE_*` 环境变量。多副本还需要共享已初始化的 bootstrap 存储并配置 Redis。

<a id="railway"></a>

### 快速部署到 Railway

使用仓库现有的 [`Dockerfile.railway`](Dockerfile.railway) 构建，最后在浏览器中完成安装。需要一个 PostgreSQL 服务，以及一个**已创建、支持 path-style URL、可通过公网 HTTPS endpoint 访问的 S3 桶**。这套单副本部署不需要 Redis。S3 endpoint 只填 origin，不带 bucket、路径或 query；凭证需允许读写、删除及条件写入，以通过安装探测。下文的 `your-domain.up.railway.app` 请替换为实际域名。

1. 打开 [Railway 新建项目](https://railway.com/new)，添加 PostgreSQL，再从 `TokenRollAI/tool-bridge` 添加 GitHub 应用服务（必要时先 Fork）。应用的 Root Directory 保持仓库根目录。
2. 部署应用前，为它添加挂载到 `/data` 的持久卷，并配置：

   | 设置 | 值 |
   |---|---|
   | 环境变量 `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.railway` |
   | 环境变量 `RAILWAY_RUN_UID` | `0`（下面的启动命令会降权） |
   | 环境变量 `TB_BOOTSTRAP_DIR` | `/data/bootstrap` |
   | Healthcheck Path | `/healthz` |
   | Replicas | `1` |

   将 **Start Command** 设为：

   ```sh
   /bin/sh -c 'install -d -m 700 -o 1000 -g 1000 /data /data/bootstrap && exec setpriv --reuid=node --regid=node --init-groups node /app/dist/main.js'
   ```

   这会先设置挂载目录的所有者，再以 `node` 用户运行应用；两个目录都需要可写，bootstrap 锁才能正常创建。应用自动读取 Railway 的 `PORT`，Build Command 留空。
3. 部署后，通过 **Settings → Networking → Generate Domain** 获取应用的公网 HTTPS 地址。目标端口使用应用的 `PORT`（未设置时默认 `8787`）。
4. 使用应用服务的 **Copy SSH Command** 进入部署容器（需安装 [Railway CLI](https://docs.railway.com/cli/ssh)），执行：

   ```sh
   if [ "$(id -u)" = 0 ]; then
     setpriv --reuid=node --regid=node --init-groups node /app/dist/admin.js pair
   else
     node /app/dist/admin.js pair
   fi
   ```

   打开 `https://your-domain.up.railway.app/ui/setup`，粘贴一次性配对凭证；填写 PostgreSQL 服务的私网 `DATABASE_URL`、S3 endpoint/bucket/region/access key/secret key，并在“公开访问地址”中填入应用的公网 HTTPS origin。Redis 留空。这些凭证通过受保护的安装页提交，不作为应用环境变量配置。
5. 完成安装并保存 Admin SK，确认 `https://your-domain.up.railway.app/readyz` 返回 HTTP 200，然后在本机连接：

   ```sh
   npm install -g @tool-bridge/cli
   tb login --base-url https://your-domain.up.railway.app
   tb call system/status/get
   ```

`/healthz` 在安装前也可能成功，业务就绪以 `/readyz` 为准。重新部署时保留 `/data`、PostgreSQL 和 S3 数据；以上挂卷方案保持单副本。

当前 S3 客户端使用 path-style URL，新建 [Railway Storage Bucket](https://docs.railway.com/storage-buckets) 使用 virtual-hosted URL，选用前需确认兼容性。私网 S3 endpoint 需要受保护的 `install-defaults.json`，见[部署指南](llmdoc/hosts-deploy/node-docker-and-helm.mdx)。平台配置参考：[环境变量](https://docs.railway.com/variables/reference)、[持久卷](https://docs.railway.com/volumes/reference)、[启动命令](https://docs.railway.com/deployments/start-command)。

### 嵌入自己的应用

```sh
npm install @tool-bridge/sdk
```

```ts
import { createToolBridge, MemoryObjectStore, MemoryStateStore } from '@tool-bridge/sdk'

const tb = createToolBridge({
  state: new MemoryStateStore(),
  // Store 是必备部署能力；内存 driver 仅适合示例/测试，生产请注入持久 S3 或自定义 driver。
  objects: new MemoryObjectStore(),
  adminSk: process.env.TB_BOOTSTRAP_ADMIN_SK!,
})

tb.registerTool('tools/echo', {
  list: () => [{ name: 'echo', description: 'Return the input text' }],
  call: (_name, args) => ({ content: { echoed: args.text } }),
})

export default { fetch: tb.fetch }
```

Node HTTP server、反向连接和自定义 store 说明见 [`packages/sdk/README.md`](packages/sdk/README.md)。

## 权限与安全边界

- 每个 SK 由 owner、路径 glob 和 `read/write/call/register/admin` 动作组成；deny 优先，无匹配默认拒绝。
- 不可见路径在 `~help`、`~tree` 和调用中返回 404，避免泄露节点是否存在。
- 上游密钥进入只写 SecretStore；节点配置、日志和只读管理响应不返回密钥值。
- 内置 Plugin 与网关同进程同权，并使用受控出站；外部 Plugin 在注册时校验 descriptor 和健康状态。
- PostgreSQL 是标准部署的权威状态后端，SK 吊销即时生效。

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
| `packages/server` | Node/PostgreSQL/S3/WebSocket 宿主 |
| `packages/cli` | `tb` CLI、设备连接与部署管理 |
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

本地 Compose 栈会启动 Node gateway、PostgreSQL 和 S3 兼容对象存储：

```sh
pnpm compose:up
pnpm compose:smoke
pnpm compose:down
```

代码与生成产物是行为真源。架构边界、协议契约、部署和验证指南从 [`llmdoc/architecture.mdx`](llmdoc/architecture.mdx) 开始阅读。

## 项目支持

<table>
<tbody>
<tr>
<td align="center">
<a href="https://linux.do"><img src="./docs/assets/linux-do.png" alt="LINUX DO" width="120"></a>
<br><sub>社区支持</sub>
</td>
</tr>
</tbody>
</table>

## License

[MIT](LICENSE)
