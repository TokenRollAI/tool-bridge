# mobile · Tool Bridge 原生移动端设计源

`mobile-app.pen` 以别名 `t` 导入 [`../foundation/tool-bridge.lib.pen`](../foundation/README.md)，覆盖 `tool-bridge-mobile` 全部 9 个路由页面、本地操作面板与两道全局安全门禁（390px 宽，Dark / Light 双主题对齐）。

## 画板清单（12 Boards）

| 画板 ID | 名称 | 尺寸 | 主题 | 对应代码入口与关键状态 |
| :--- | :--- | :--- | :--- | :--- |
| `NWZNJ` | `01 · 信箱 · 未读与最新消息` | `390×844` | Dark | `InboxScreen`：琥珀未读圆点、高优标记、搜索与全部/未读筛选、底部悬浮双页签胶囊栏 |
| `M5WsN6` | `02 · 信箱 · 浅色未读清零` | `390×844` | Light | `InboxScreen` 浅色模式同源对照 + 未读消息全部处理完毕空态 |
| `mPhJz` | `03 · 消息详情 · 受控 Markdown 阅读` | `390×844` | Dark | `InboxMessageScreen`：结构化报告阅读、受控 HTTPS 外链提示、默认不自动加载的外部图片手动触发槽 |
| `xoYpB` | `04 · 信箱 · 清空本机信箱确认` | `390×844` | Dark | `ActionSheet`：不可恢复清空二次范围确认，写明保留防重放记录、活动审计与本机凭证 |
| `L5EGrT` | `05 · 设备 · 已连接与直接调用` | `390×844` | Dark | `SettingsScreen`：紧凑可复制设备 ID 铭牌、在线网关状态、分组导航、直接调用告警与触手可及的紧急停用按钮 |
| `ubbr0` | `06 · 设备 · 浅色停用与恢复` | `390×844` | Light | `SettingsScreen` 紧急停用锁定态（拒绝一切新远程命令，唯一恢复动作为「恢复为每次确认」） |
| `tz6LB` | `07 · 连接配置 · 遮蔽凭证及校验错误` | `390×844` | Dark | `ConnectionSettingsScreen`：HTTPS origin 行内错误反馈、始终遮蔽的 API key 与可选设备 ID |
| `vsyoq` | `08 · 授权与安全 · 控制模式与系统权限` | `390×929` | Dark | `ControlSettingsScreen`：三种控制模式单选、直接调用前台相机说明、后台运行开关（高对比滑块）与系统权限主动启用卡 |
| `Og3eR` | `09 · 设备能力与运行详情 · 探测及本机停止` | `390×1108` | Dark | `CapabilitiesScreen`（可用/需授权/受限）+ `HomeScreen`（正在提示设备与本机计时器立即可停） |
| `bBr3k` | `10 · 媒体会话与活动记录 · 区分裁决和结果` | `390×992` | Dark | `MediaScreen`（自有音频暂停/停止）+ `ActivityScreen`（仅展示元数据，明确区分允许成功 vs 允许但权限拒绝失败） |
| `mnh2L` | `11 · 全局门禁 · 等待本地确认` | `390×844` | Dark | `PendingConfirmationModal`：合并单标题、队列进度提示、次级中性按钮「拒绝」配单色主按钮「允许一次」 |
| `b0fNE` | `12 · 全局门禁 · 前台相机与上传复核` | `390×1203` | Dark | `CameraCaptureModal`：可见前台取景预览 + 拍摄后人工复核（「重新拍摄」/「使用并上传」）两阶段完整闭环 |
