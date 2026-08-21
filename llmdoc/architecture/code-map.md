# 代码地图

## 根入口

| 路径 | 用途 |
|---|---|
| `package.json` | 根验证、构建、部署、smoke 脚本 |
| `scripts/release-plan.mjs` | public package 发布计划与顺序 |
| `scripts/provision.mjs` | Cloudflare 资源创建与账户配置回填 |
| `scripts/verify-*.ts` | MCP、Search、设备、plugin、吊销的 opt-in 验收 |
| `.github/workflows/` | CI 与逐包发布工作流 |

## core

| 主题 | 路径/符号 |
|---|---|
| 公共类型与 NodeKind | `packages/core/src/types.ts` |
| 授权与 SK | `auth/authorizer.ts`、`auth/sk.ts`、`auth/secretRef.ts` |
| 树与 registry | `tree/registry.ts`、`tree/path.ts`、`builtin/registry.ts` |
| builtin 装配 | `builtin/index.ts` |
| 外部 plugin 注册 | `builtin/plugin.ts`、`plugin/manifest.ts`、`plugin/contract.ts` |
| 内置 catalog | `builtin/catalog.ts`、`plugin/catalog.ts` |
| Search 契约 | `search/types.ts`、`search/sqlSearchIndex.ts`(编排 + `SqlSearchDialect`)、`search/pgSearchDialect.ts` |
| 设备协议 | `device/frames.ts`、`device/session.ts`、`device/client.ts` |
| HTBP 表示 | `htbp/helpDsl.ts`、`helpMarkdown.ts`、`tree.ts` |

## app

| 主题 | 路径/符号 |
|---|---|
| 宿主注入类型 | `packages/app/src/deps.ts` / `TbAppDeps` |
| app 组装 | `tbApp.ts`、`bootstrap.ts` |
| 路径与节点分发 | `paths.ts`、`toolNodes.ts`、`contextNodes.ts`、`deviceNodes.ts` |
| 路由 | `routes/` |
| MCP 上游 | `providers/mcp.ts`、`mcpServer.ts` |
| plugin 调用 | `providers/pluginClient.ts` |
| remote 联邦 | `providers/remote.ts`、`federation.ts` |

## 宿主与客户端

- Workers：`packages/gateway/src/app.ts` 装配 Env；`deployEntry.ts` 全量装内置 catalog；`kvStateStore.ts`、`search/d1SearchIndex.ts`、`deviceSession.ts` 是适配器。
- Node：`packages/server/src/main.ts`、`server.ts`（`resolveBackends` 选 state/search 后端）、`config.ts`；SQLite/PG/FS/ws 实现在同包（`sqlite*` / `pg*`）。
- SDK：`packages/sdk/src/toolBridge.ts`、`deviceClient.ts`、`types.ts`。
- CLI：`packages/cli/src/program.ts` 装配命令；`commands/` 按业务拆分；`http.ts` 统一调用与错误。
- Dashboard：`packages/dashboard/src/lib/` 是 API/query/session；`pages/system/` 是系统控制面；`components/` 是共享 UI。

## plugin

- 作者面：`packages/plugin-sdk/src/index.ts`。
- 内置装配：`packages/plugins/src/registry.ts`。
- 生成产物：`catalog.generated.ts`、`registry.generated.ts`。
- 生成器：`packages/plugins/scripts/generateCatalog.ts`、`generateRegistry.mjs`。
- 迁移闸门：`packages/plugins/test/migration/`、`migration-fingerprints.json`。

## 查找习惯

先从符号而不是历史文档搜：

```sh
rg "createTbApp|TbAppDeps|BUILTIN_MODULES" packages/app
rg "CatalogListItem|exportDetails" packages/core packages/cli packages/dashboard
rg "NodeKind|NODE_KINDS" packages/core
rg "system/catalog|system/plugin" packages llmdoc
```

精确测试数、行数、bundle 字节和生成目录规模不属于代码地图；需要时从当前工作树实查。
