# 默认 Compose 的一致性备份与隔离恢复

这套脚本面向仓库根目录 `docker-compose.yml` 的**已初始化、单副本、内置 PostgreSQL 18 + SeaweedFS** 部署。它通过停写后的物理卷快照保存部署状态，不访问外部 S3，不执行在线数据库迁移。

备份包含五个卷：

| 卷 | 内容 |
| --- | --- |
| `bootstrap` | `/data/bootstrap` 的实例身份、初始化标记、PG 连接、加密和签名 keyring、恢复凭证 |
| `postgres-data` | PostgreSQL 18 在 `/var/lib/postgresql` 下的整个数据目录 |
| `objects-data` | SeaweedFS `/data` 的对象数据、索引与元数据 |
| `pg-secrets` | PG 初始化和应用连接凭证 |
| `s3-secrets` | S3 身份及初始化配置 |

Redis 只保存可重建的设备路由，因此不进入物理备份。设备本地目录、设备 journal 和远端 Context/上游服务数据不属于这五个部署卷。

## 备份

在对应仓库版本中安装工具依赖，并确保源 PostgreSQL 正在运行：

```bash
pnpm install --frozen-lockfile
node scripts/compose-backup.mjs --project tool-bridge --out ./backups/2026-09-05
```

`--out` 必须是尚不存在的目录。脚本会：

1. 验证容器、镜像、named volume 和默认网络均属于指定 project；拒绝多副本、初始化仍在运行、卷被其他容器占用的情况。
2. 检查 bootstrap 指向默认 `postgres/toolbridge`，停止应用后只读核对 PG 实例身份和所有 storage backend 均位于 `http://objects:8333`。配置过外部数据库或桶时拒绝声明“完整物理备份”。
3. 停止 PostgreSQL 和对象服务，确认 PG 正常退出后，逐卷生成 gzip tar 归档。
4. 校验归档形状，最后写入 `meta.json`。元数据记录实例身份、Compose 文件 SHA-256、所有服务的镜像 ID/ref/digest、每个归档的 SHA-256 和大小。
5. 无论成功还是失败，都尝试按基础设施→应用的顺序启动原来运行的服务；原来停止的服务保持停止。

目录权限为 `0700`，归档、元数据和失败留下的临时文件均为 `0600`。备份包含完整密钥和数据，应加密后离线保管。缺少 `meta.json` 的目录是不完整备份，恢复脚本不会接受。

## 恢复到隔离 project

恢复前必须准备与备份完全相同的仓库 Compose 文件和本地镜像。脚本校验镜像 ID、架构和操作系统，不会自动拉取、构建或替换镜像。**PostgreSQL 18 的物理快照只能按此流程恢复到同一镜像版本**，不能把升级数据库混进恢复操作。跨机器恢复时，还需另行保存/加载备份所列镜像；只有卷归档不够。

```bash
node scripts/compose-restore.mjs \
  --from ./backups/2026-09-05 \
  --project tb-restore-check \
  --replace
```

`--replace` 明确授权替换**该目标 project**的五个卷。目标不能与源 project 相同，也不能是默认 `tool-bridge`；本轮工具只提供异项目克隆，不提供原地清空生产部署的开关。

新项目默认绑定随机的 `127.0.0.1` 端口，成功后输出实际访问地址。需要固定端口时可加 `--port 39800`；恢复已有目标会保留它原来的 loopback 端口，不允许借恢复命令修改端口。

在停止或清空目标之前，脚本先验证**全部**归档的大小、校验和、路径形状和镜像版本。归档只允许普通文件和目录，拒绝绝对/父级路径、符号链接、硬链接和特殊文件；默认 PG 布局不支持自定义外置 tablespace。

目标停止后，脚本先为目标原有的五个卷生成私有回滚快照，再替换数据；启动 PG/S3 和应用时不会重新运行 `init` 或 `init-bucket`。最后检查应用 `ready`、实例身份和 `/readyz`，再用镜像内 AWS SDK 对实际 bucket 执行 LIST→HEAD→首字节 GET，确认卷已注册且数据通路可读。凭证只从目标 secret 卷读取，不进入命令行参数或输出。仅 HEAD 成功不能作为完成依据。

恢复失败会先停止目标，再恢复原目标卷，并重新启动原来运行的目标服务。若回滚自身也失败，脚本保留私有回滚目录、输出路径并让目标保持停止，不能把部分恢复的数据作为成功服务启动。源项目不受恢复操作影响。

容器重启会保留恢复时的端口；手动启动已有恢复容器可使用：

```bash
docker compose --project-name tb-restore-check --file docker-compose.yml start postgres objects app
```

备份期间请勿由其他终端启动这些服务、修改卷或升级镜像。正常的 `SIGINT`/`SIGTERM` 会进入清理与重启流程；宿主断电或 `SIGKILL` 无法执行进程内恢复，应先检查服务状态再重试。归档校验和用于检测损坏，不等于备份来源的真实性证明。

## 验证

```bash
node --test scripts/compose-snapshot.test.mjs
```

这组测试覆盖路径/链接拒绝、卷清单完整性、危险目标和缺少授权拒绝、校验和/镜像失败时不停止服务、备份失败恢复原运行状态及文件权限，以及 S3 数据探针失败时不得宣布恢复成功。真实演练还应在独立 project 中完成“写节点和 Store 对象→备份→恢复→HTTP 读回”，不能仅以 tar 命令退出成功代替数据验收。

实现使用 [Commander](https://github.com/tj/commander.js) 解析参数、[node-tar](https://www.npmjs.com/package/tar) 检查归档，字节打包与解包由镜像内 GNU tar 执行。所有 Docker 调用使用固定程序和参数数组，不执行用户提供的 shell。
