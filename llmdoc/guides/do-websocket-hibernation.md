# DO WebSocket Hibernation 生产坑(设备网关)

> 用途:Durable Object hibernation WebSocket 在**生产环境**的行为约束与本项目的既定解法。任何改动 `packages/gateway/src/deviceSession.ts`、`packages/core/src/device/`、`packages/cli/src/deviceRuntime.ts` 前必读。更新时机:设备通道协议或休眠策略变化时。来源:2026-07-06 设备通道生产 blocker 实测(排查过程的流程教训见 [verification-and-commit-practices.md](verification-and-commit-practices.md))。

## 坑 1:空闲 WS 约 100 秒被边缘掐断,且客户端半开无感知

- 生产实测:无流量的设备连接全部在连上后 ~84-167s 离线;本地 miniflare 永不复现。
- 客户端(Node ws)对边缘侧掐断可能**毫无感知**(半开连接):不触发 close 事件 → partysocket 不重连 → 设备看似连着实际已死。
- **解法(已实现)**:客户端应用层心跳,`deviceRuntime.ts` 的 `startHeartbeat`——每 30s 发 `PING_FRAME_JSON`;一个周期内无任何入站帧判定死链,`socket.reconnect()`(partysocket 重连后 `DeviceClient.socketOpened` 自动重发 hello)。
- 网关侧 `setWebSocketAutoResponse(PING→PONG)` 自动应答,**不唤醒 DO**(零计费唤醒),这正是 `frames.ts` 里 ping/pong 定义为稳定字面量的原因:auto-response 按字符串精确匹配。

## 坑 2:hibernation 唤醒后 DO 内存态全丢,状态机必须可从 storage 恢复

- 客户端心跳被 auto-response 应答、不唤醒 DO ⇒ 空闲设备的 DO **必然休眠驱逐**。下一次 invoke 唤醒时:`ctx.getWebSockets()` 能恢复 socket、attachment/tag 都在,但所有内存对象是新建的。
- 本项目症状:重建的 `DeviceGatewaySession` 处于 `awaiting-hello`,`call()` 直接回 device offline——socket 活着、meta 完好,状态机却忘了 hello 已完成。更糟:此时设备来帧会被判"未 hello 先发帧"而 protocolReject 掐线。
- **解法(已实现)**:hello 完成的事实持久化在 DO storage(`meta.activeConnId` = socket attachment 的 `connId`);会话惰性重建(`sessions: Map<WebSocket, Promise<DeviceGatewaySession>>`,Promise 防并发重建),`initSession` 发现 `meta.activeConnId === attachment.connId` 即调 `DeviceGatewaySession.restoreReady()` 直接进 ready(不重发 ready 帧)。
- 通用规则:凡"连接已就绪/已认证"类内存标志,必须有 storage 依据 + 唤醒恢复路径;constructor 里不要做需要读 storage 的恢复(sync 限制),恢复放惰性 async 路径。

## 坑 3:本地测试环境测不出以上两条

- miniflare/workerd 测试里 DO 不驱逐、无边缘代理超时 ⇒ hibernation 唤醒路径与空闲掐断只能**线上验证**。
- 排查手法:`npx wrangler tail tb-gateway --format pretty`(observability 已开)+ 临时 `console.log`(验证完删除);对照实验"连上立即调用(t0)vs 空闲 150s 后调用",一次区分路由/attachment 问题与休眠状态问题。
- 验收要求:设备通道改动的真实环境验证必须含**跨休眠窗口用例**(≥150s 空闲后 call 成功)。

## 相关既定事实

- 部署(代码更新)会掐断所有 WS;客户端靠 partysocket 重连 + 重发 hello 自愈,已生产实测。
- registry 的 `online` 标志经 KV 写入,最终一致且断线检测是惰性的(invoke 时 `activeSocket()` 发现丢失才 `markDisconnected`);判断设备真实在线以 invoke 结果为准,`tb device ls` 仅供参考。
- 设备调用超时 60s(`DEVICE_CALL_TIMEOUT_MS`);pending call 持有 setTimeout,期间 DO 不休眠。
