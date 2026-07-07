# Phase 4 设备网关生产 blocker 排查反思(2026-07-06)

> 范围:设备 WS 生产环境 "device offline" 排查与修复。技术结论已沉淀到 [../../guides/do-websocket-hibernation.md](../../guides/do-websocket-hibernation.md);本文只记流程教训。

## 1. 本地 miniflare 全绿 ≠ hibernation 相关行为正确

DO hibernation 的驱逐/唤醒在 vitest-pool-workers/miniflare 里**不会发生**,任何依赖"内存态在连接期间一直存在"的假设本地测不出来。本轮 gateway 集成测试 49 条全绿,生产照样 100% 复现 offline。

**下轮怎么做**:凡涉及 DO 内存态 + 长连接的功能,DoD 的"真实环境"验证必须包含**跨休眠窗口**(≥2 分钟空闲后再调用)的用例,不能只测连上后立即调用。

## 2. 连环根因:修掉第一层才暴露第二层

本次实际有两层独立缺陷,症状同为 "device offline":
1. 客户端无心跳 → Cloudflare 边缘 ~100s 空闲掐断 WS,且客户端半开无感知、不重连;
2. 修掉 1 之后仍复现 → DO hibernation 唤醒后 `DeviceGatewaySession` 内存状态机丢失 ready 态,socket 明明还在却拒调用。

之前多轮尝试(tag 查找、constructor 恢复、RPC 化)全在错误层面上打转,因为没有先取证就改代码。

**下轮怎么做**:生产 blocker 先取证后改码——时间线证据(registry updatedAt 间隔揭示"全部 ~2min 死亡"模式)+ 对照实验(t0 调用成功 vs t150 失败,直接排除路由/attachment 假设)+ 线上 `wrangler tail` 加临时 console.log 抓现场(`ctor restored=1` 后 activeSocket 命中但仍 offline,一条日志锁定状态机层)。

## 3. 验收命令里的标识符要逐字核对

失败 transcript 里 connect 用 `codex-p4-ctor-0707`、call 打 `codex-p4-rpc-0707`,deviceId 根本不一致;另外多轮验证各起一个新 deviceId,留下 6 个离线注册残骸和多个僵尸 connect 进程。排查时这些噪声一度掩盖真信号。

**下轮怎么做**:多轮真实环境验证复用同一个测试 deviceId;验证脚本把 connect 与 call 的目标路径写成同一个变量;轮末清理测试进程与注册残骸。

## 4. 后台长驻进程验证要管理生命周期

`tb connect` 是前台长驻进程,agent 用带超时的 exec 跑它,超时即被杀 → 设备离线,后续 call 全失败,却被误读为网关 bug。

**下轮怎么做**:验证长驻进程用 `nohup ... &` 起、记 PID、验证完 kill;判断"设备是否在线"以 DO 侧(invoke 结果)为准,registry 的 online 标志经 KV 最终一致,可能滞后或残留。

## Promotion Candidates

- 已提升:hibernation 三条硬规则 → [../../guides/do-websocket-hibernation.md](../../guides/do-websocket-hibernation.md)。
- 待办:Phase 4 关门时把"跨休眠窗口调用"写进可重跑验收脚本(类似 verify-revocation.ts)。
