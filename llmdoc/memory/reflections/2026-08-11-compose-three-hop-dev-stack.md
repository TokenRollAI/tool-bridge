# 反思:Docker Compose 三跳开发栈的可验证性

## Task

- Round 26 为本地开发补齐 gateway、真实 plugin-feishu Worker 与 mock TAT/MCP upstream 的 Docker Compose 栈，并让一条命令可重复验证完整代理链路。

## What Changed During Verification

- 三个服务各自 `/healthz` 为 200 只证明进程存活，不能证明 gateway 的 SecretRef、plugin contract、registry mount、飞书 TAT 换发和 MCP 调用串在一起。最终 smoke 从 gateway 写入 secret、注册 plugin、挂载 export，再调用 `compose/tools:echo` 并断言 mock upstream 生成的精确结果。
- 把一次性 smoke 放进普通 `docker compose up -d` 无法把任务退出码传播给调用者；最终将其放入 `smoke` profile，由 `docker compose run --rm smoke` 作为同步验收命令。
- 多个服务并发构建同一 target/tag 会在 BuildKit 导出本地镜像时冲突。最终只由 upstream 构建 `tool-bridge-compose-dev:local`，plugin 与 smoke 以 `pull_policy: never` 复用该镜像；容器命令直接调用 `node_modules/.bin/tsx` 和 `node_modules/.bin/wrangler`，避开 build target 中 `pnpm exec` 试图在无 TTY 环境补装缺失命令的不确定分支。

## Durable Lesson

1. **健康检查不能冒充依赖链证据。** smoke 必须从公开 gateway 入口进入，经过真实插件运行时，再由 mock TAT/MCP 上游产生可辨识响应；并列探测三个 health endpoint 只能作为前置等待。注册、发现、挂载或鉴权任一步被短路时，端到端断言都应失败。
2. **固定开发凭据必须和暴露面一起审计。** 可提交的 admin SK、plugin token、app credential 只适用于隔离开发栈；默认仅把 gateway 发布到 `127.0.0.1`，plugin/upstream 只在 Compose 网络 `expose`。改变 host bind、反向代理或共享 Docker 网络时，必须先替换凭据，不能因值可配置就把默认值视为安全。
3. **后台编排与同步验收是两种进程语义。** `docker compose up -d` 成功表示容器已调度，不会可靠传递一次性任务稍后退出的状态。长驻栈用 `up -d`，验收任务用 profile 隔离并显式 `docker compose run --rm smoke`，让 CI/shell 直接收到 smoke 的退出码且不在默认启动中残留已退出容器。
4. **共享开发镜像要有唯一构建所有者。** 相同 target/tag 不应由多个 Compose service 并发导出；选择一个 service build，本地消费者声明同一 image 与 `pull_policy: never`。运行命令则调用镜像内已安装的 `.bin`，使缺依赖立即失败，而不是让包管理器在无 TTY 的容器启动期尝试修复环境。
5. **持久卷要求 smoke 本身幂等。** 固定 secret、plugin id 与 registry path 必须通过 set/write/upsert 收敛，重复执行不能依赖空数据库。`compose:down` 明确只停栈并保留 `gateway-data`，`compose:reset` 才用 `down -v` 删除身份与状态；两者不能都叫“清理”，否则开发者会误判重启后的凭据和数据生命周期。
6. **负例要绕过缓存，重启要验证持久性。** 仅改已换发过 TAT 的 secret 可能继续命中 plugin token cache，产生假绿；使用全新错误 `app_id` 可强制换发并观察 upstream 401、gateway 503，证明调用没有在 gateway/plugin 内短路。随后恢复正常 smoke、重启 gateway 再运行，才能同时证明错误可恢复和挂载/secret 状态来自持久卷而非进程内偶然状态。
7. **mock 应缩短外部边界，而不是替换被测中间层。** mock TAT/MCP 可以固定响应并拒绝错误凭据，但 plugin-feishu Worker 必须是真实构建与真实 Wrangler runtime；用简单 echo plugin 替代它会跳过本轮最需要验证的协议适配和凭据交换。

## Promotion Candidates

- 开发指南可固化 Compose 的四层验收契约：loopback 暴露、唯一 dev-image builder、profile smoke 的同步退出码、保留卷与删除卷的两种 teardown。
- 集成测试指南可加入“链路正例 + 新缓存键错误凭据负例 + gateway restart 后正例”的固定三步，避免只看 health 或被认证缓存掩盖。

## Evidence Boundary

- 当前本地 Compose 实跑已证明：同一卷连续两次 smoke 通过；全新错误 `app_id` 在 TAT 上游返回 401 并使 gateway 调用以 503 失败；恢复后通过，gateway restart 后再次通过。它证明本地容器链路、失败传播与卷内状态恢复，不代表生产凭据、外部飞书服务、跨主机网络或部署环境已经验证。
