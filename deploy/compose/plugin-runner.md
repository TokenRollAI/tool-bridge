# 部署插件分发运行器

已托管服务可以直接安装。镜像制品需要部署管理员在网关容器外启动运行器。运行器使用 Docker CLI 和本机制品许可表。网关只访问运行器的 Unix socket。

## 分发清单

每份清单选择一个版本独占的 HTTPS 端点或一个完整 OCI 镜像摘要。例如托管版可使用以下内容。

```json
{
  "schemaVersion": "tb-plugin-release/v1",
  "id": "notes",
  "version": "1.0.0",
  "endpoint": "https://plugins.example.org/notes/v1",
  "healthPath": "/healthz"
}
```

容器版将 `endpoint` 换为 `image`，值形如 `registry.example.org/tools/notes@sha256:<64 位小写十六进制>`。镜像自带入口，须可在只读根文件系统运行，且不能声明 VOLUME。在 8080 端口监听，从 `PLUGIN_TOKEN` 读取传输密钥。HTTPS 反代应剥掉版本路径前缀，插件收到的生命周期路径为 `/healthz`、`/~describe` 和 `/~auth`。最后一个端点接受 HEAD，错误 bearer 返回 401 或 403，正确 bearer 返回 204 并带 `X-TB-Plugin-Auth: plugin/v2`。本版 plugin-sdk 提供此端点。挂载后的数据面仍使用原有 plugin/v2 envelope。

- HTTPS 来源直接提供清单 JSON，使用无查询串、无凭证、无需跳转的地址。
- npm 来源使用 `npm:@scope/package@1.0.0`，该版本的 package.json 中的 `toolBridgePlugin` 放入完整清单，版本与包版本一致。也可直接粘贴固定版本网页，例如 `https://www.npmjs.com/package/@scope/package/v/1.0.0`。
- GitHub 来源使用 `github:owner/repo@v1.0.0`，在这个公开 Release 下上传名为 `tool-bridge-plugin.json` 的资产。支持直接粘贴 `https://github.com/owner/repo/releases/tag/v1.0.0`。包或仓库首页会提示选择固定版本。

`source` 保留输入地址，`resolvedSource` 记录固定来源，`approvedBy` 记录批准该候选的管理员密钥 ID。`digest` 为规范化清单的 SHA-256（字段排序，补默认 healthPath），`image` 中的摘要标识实际容器制品。托管服务由其部署者负责保证版本 URL 指向固定代码。网关需要按部署要求约束出网及 DNS。

## 管理员启动运行器

1. 为插件建立独立的 Docker bridge 网络，例如 `tb-plugins-egress`。用宿主网络策略限制插件访问网关管理面、内网和元数据端点。运行器复用本机缓存；首次使用时按许可表的完整镜像摘要自动拉取。私有 OCI 仓库使用运行器宿主的 Docker 登录凭据。拉取后先验证镜像无可写卷，再创建容器。
2. 为每个 release 分配独占的本机端口和 HTTPS 反代端点。创建权限受限的 token 文件，并把同一值写入网关的命名 secret。各版本沿用这个 secret。配置示例如下，替换镜像摘要后使用。

```json
{
  "network": "tb-plugins-egress",
  "releases": [{
    "id": "notes",
    "image": "registry.example.org/tools/notes@sha256:<完整摘要>",
    "port": 19101,
    "endpoint": "https://plugins.example.org/notes/v1",
    "tokenFile": "/etc/tool-bridge/plugins/notes.token"
  }]
}
```

3. Docker 默认连接本机 /var/run/docker.sock。rootless Docker 可通过 DOCKER_HOST 指定本地 unix:/// 套接字。在 Docker 宿主运行 `tool-bridge-admin plugin-runner --policy /etc/tool-bridge/plugins/policy.json --socket /run/tb-plugins/control.sock`。套接字目录归管理员所有，允许网关进程所在组遍历，套接字模式为 0660。使用进程管理器保持服务运行，更新许可表后重启运行器。为回滚保留上一版条目、反代及镜像。
4. 只将该 socket 所在目录只读挂载到业务容器，配置 `TB_PLUGIN_RUNNER_SOCKET=/run/tb-plugins/control.sock`。Docker socket 和凭据文件仅留在宿主。运行器按批准的 ID 和镜像派生容器名，只调用固定 Docker 参数。容器以非 root 用户运行、根文件系统只读、移除全部 capabilities，设置 CPU、内存、进程数和临时目录限额。

## 安装和切换

```sh
tb plugin install https://plugins.example.org/notes/release.json --secret-ref notes-transport
tb plugin upgrade notes npm:@scope/notes@2.0.0
tb plugin refresh notes
tb plugin rollback notes
tb plugin get notes --json
```

install、upgrade 和 rollback 需要 system/plugin 和 system/secret 的 admin 权限。对于 npm 或 GitHub 指向已托管端点的首次安装，传入 `--origin https://plugins.example.org`。HTTPS 清单默认信任其自身 origin。升级沿用首次批准的托管 origin，禁止从托管模式切到镜像模式。来源中不可携带 secret 或启动参数。

首次安装只创建新注册。refresh 重新解析当前来源并复核服务。切换前先检查健康、描述和 bearer 认证，随后一次写入活动版本、描述和上一版本。回滚直接复用已存的上一版制品和端点，再执行同样的验证。失败后可修复服务再重试。仅保留一级回滚记录。成功回滚后重试会保持现状。需要跨其他操作重试时，使用 `tb plugin rollback notes --digest <目标清单摘要>`。容器按版本复用，卸载和失败均保留容器，由宿主管理员确认不再被使用后回收。独立部署网关的多副本须能访问同一个运行器及版本端点。

容器候选通过探活和认证后才开始接收挂载流量。已有挂载的 OAuth 声明相同时保留授权，仅刷新工具缓存。变更 OAuth 声明会使旧授权失效。分发升级沿用原有插件 bearer 引用。

## 升级前预览

`tb plugin preview notes [source] --json` 返回导出的新增、删除和描述变化，以及当前可读的挂载路径。候选无法解析的挂载单独列在 `incompatibleMounts` 中。预览使用和升级相同的来源、权限和 bearer 校验，活动注册、缓存和挂载保持原状。镜像版需要运行服务才能取得真实 descriptor，首次预览会按需拉取镜像并启动已批准的候选容器，再次预览可复用该容器。

确认时使用 `tb plugin upgrade notes [source] --digest <candidateDigest>`。管理 API 对应 `preview {id,source?}` 和 `upgrade {id,source?,candidateDigest?}`。确认摘要包含当前注册修订、固定来源、清单摘要、端点和验证过的 descriptor。任何一项变化都会使旧确认失效。挂载清单反映预览时的注册树。
