# 反思:E2E 安全验收的证据敏感性

## Task

- Round 27 补强 E2E-A：生产 smoke 必须认证 fail closed，设备同 ID 替换要同时具备本地确定性 TOCTOU 回归和可授权执行的真实进程 smoke，并保留生产部署、DO hibernation 的证据边界。

## What Changed During Review

- 最初的 `verify-device` replacement 流程只等新连接 ready、旧连接 reconnecting 后再调用。它能证明稳态最终路由与 stale close guard，却没有让 invoke 捕获旧连接后停在异步 `identify`，删除 post-await generation guard 仍会通过，不能作为原始 TOCTOU 的回归证据。
- 最终 Node 集成测试在旧连接 invoke 的 SK 读取处设置 barrier，barrier 内建立同 deviceId 新连接；同时 mock 旧 server-side socket 的 close，让旧 session 仍能接收并响应 call。释放 barrier 后必须 fail closed 且新旧连接都收不到本次 call。mutation probe 删除 generation guard 时测试真红，证明断言对目标防线敏感，而非被 dispose/close 偶然兜底。
- 部署 smoke 原先缺 `TB_SK` 时只跳过认证探针并退出 0；现在在任何 fetch 前拒绝缺失 SK，同时保留匿名 401 与认证 markdown/DSL 200 两侧断言。

## Durable Lesson

1. **安全测试必须证明自己对防线敏感。** “测试覆盖了相同函数”不等于覆盖竞态窗口。先画出捕获旧 generation → await 授权 I/O → replacement → 恢复下发的时序，再用可控 barrier 固定交叉点；最后临时删除目标 guard 做 mutation probe。若测试仍绿，它只能证明邻近行为，不能登记为该安全不变量的证据。
2. **竞态负例不能依赖正常 teardown。** replacement 通常会关闭旧 socket，旧 session 随之不可调用，即使 generation guard 缺失也可能自然失败。测试必须让 stale session 保持可调用，并使它在误下发时返回成功；这样“旧连接未收到 call”才由 post-await 复核保证，而不是由连接已死保证。
3. **稳态 smoke 与窗口级回归要分账。** 真实 `verify-device` 用新代际独有的 `printf` 命令标识最终路由，旧代际只允许 `echo`；等待 replacement ready 的同时，一收到 old reconnecting 就 stop 旧进程，缩小自动重连抢回 active 的 flake 窗口。这能证明真实 WebSocket close/reconnect 生命周期和 stale close 不误下线新代际，但不能证明调用恰好跨过 `identify` await。
4. **认证步骤不可选时，缺凭据必须非零退出。** 部署 smoke 若在缺 `TB_SK` 时输出 skip 后返回 0，只证明匿名 health/help，不足以验收已部署系统的认证面。必需凭据应在网络请求前校验；匿名 401 与带已知 admin SK 的 200 都要执行，调用方也不能用普通 read SK 冒充 admin 身份。
5. **安全进程 probe 的输出也是敏感面。** stdout/stderr 应落到隔离临时文件，只用 secret pattern 判定是否泄漏，报告退出码与 `secret_like_output=absent`；不要 `cat` 捕获内容，因为一旦回归真的打印秘密，诊断动作本身会把秘密再次扩散到终端或 CI 日志。临时数据目录、端口与生产卷也必须隔离。
6. **本地确定性与生产真实性互补，不能互相代领。** Node barrier 钉住算法时序并可快速 mutation；隔离进程 smoke 钉住 CLI、HTTP、WebSocket 与退出码；授权后的生产 replacement/hibernation 才能覆盖 Cloudflare 部署、KV 传播、Durable Object 驱逐/唤醒和真实网络。未运行的生产步骤必须保持 PENDING，不能因 `pnpm verify` 全绿而勾 DoD。
7. **生产写探针应复用现有生命周期并降低 flake。** replacement 应使用同 deviceId、代际独有能力作为路由标记，并让 old reconnecting 后的 stop 与 replacement ready 并发，而不是先等新连接完全稳定才停旧连接。脚本仍会创建/吊销 SK、注册/删除节点，属于需授权外向动作；cleanup 失败与输出脱敏也应作为后续独立风险跟踪。

## Promotion Candidates

- 安全验收指南可为竞态测试加入固定模板：明确 happens-before、设置 barrier、保持 stale 对象可操作、断言零副作用，再用 mutation probe 校验测试敏感性。
- 部署指南可把证据分成 deterministic local、isolated process、authorized production 三层，并明确缺生产凭据、非干净目标版本或未获授权时必须停在 PENDING。

## Evidence Boundary

- 当前 Node barrier 测试与 mutation probe证明 `DeviceHub.invoke` 的 post-identify generation guard；本轮定向测试 12/12 通过。缺 `TB_SK` 的 smoke 真实进程 probe 在网络前退出 1，输出未命中 secret pattern。已有隔离 Node 进程验证 replacement steady-state，但未执行需授权的生产部署、生产 replacement 或 `TB_VERIFY_HIBERNATION=1`；Node barrier 也不等于 Workers Durable Object 的 stale-meta、驱逐与 hibernation 生产证据。
