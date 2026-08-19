# Durable Object WebSocket 休眠

Cloudflare 设备连接由 Durable Object 持有。正确性不只包括“能连上”，还包括对象被回收后能恢复会话归属并继续转发。

## 不变量

- 设备帧使用 core 的稳定 codec；ping/pong 字面量由共享常量产生。
- DO 使用 WebSocket auto-response 处理 heartbeat，避免仅为 pong 唤醒对象。
- 当前活动连接标识写入 DO storage；对象恢复时从 storage 重建必要状态，不依赖旧内存。
- KV 中的 online 位仍不是强一致租约；真正发送以 DO 内活动 socket 为准。但发现面不再只凭这个位:
  节点带 `lastSeenAt`(hello 与 alarm 心跳巡检写入),`~tree`/`~help`/`device ls` 投影时经
  `derivePresence` 结合 TTL 把过期的 online 降级为 `stale`——避免树谎报 online 而调用返回 offline。
- DO 用 auto-response 应答 ping/pong **不唤醒对象**,故心跳无法在收到 pong 时写 KV。改由周期 alarm
  巡检:有活连接时读 `getWebSocketAutoResponseTimestamp(ws)` 回写 `lastSeenAt` 并重排 alarm;无活
  连接且已断线时才执行 reclaim。同一个 alarm 多用途,靠 `meta.activeConnId` 是否存在分流。
- 投影是只读降级:读路径按 `lastSeenAt` 把 online 显示为 stale,但**绝不回写** `setOnline(false)`
  (权威状态只由连接生命周期写)。
- close/error、替换连接和过期状态都必须清理,且不得让旧连接覆盖新连接。Node 宿主启动 `sweepOrphans`
  的崩溃态分支(meta 无 disconnectedAt 却无活连接)也要同步把 registry online 翻 false,不能只排 reclaim。

## 验证

普通 Miniflare 测试能覆盖帧、路由和状态转换，但不能证明真实边缘发生过 eviction。真实环境验证使用：

```bash
TB_BASE_URL=https://example.invalid \
TB_ADMIN_SK=... \
TB_VERIFY_HIBERNATION=1 \
pnpm tsx scripts/verify-device.ts
```

脚本会跨越足够长的空闲窗口后再次调用。该验证消耗真实部署，只在明确授权后执行；一次成功的时间数字不是长期 SLA，也不应固化进文档。

若失败，分别检查设备端 heartbeat、DO storage 的连接归属、KV 路由提示和调用端超时，不要用增加重试掩盖状态恢复错误。
