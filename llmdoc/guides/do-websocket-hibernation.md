# Durable Object WebSocket 休眠

Cloudflare 设备连接由 Durable Object 持有。正确性不只包括“能连上”，还包括对象被回收后能恢复会话归属并继续转发。

## 不变量

- 设备帧使用 core 的稳定 codec；ping/pong 字面量由共享常量产生。
- DO 使用 WebSocket auto-response 处理 heartbeat，避免仅为 pong 唤醒对象。
- 当前活动连接标识写入 DO storage；对象恢复时从 storage 重建必要状态，不依赖旧内存。
- KV 中的 online 状态只用于发现和路由提示，不是强一致租约；真正发送仍以 DO 内活动 socket 为准。
- close/error、替换连接和过期状态都必须清理，且不得让旧连接覆盖新连接。

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
