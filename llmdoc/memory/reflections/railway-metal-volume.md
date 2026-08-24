# 反思：Railway Metal builder 与镜像卷声明

任务：将已发布的 search v4 同步部署到 Cloudflare Worker 与 Railway Node 宿主。

## 发现

1. Railway 旧部署健康不代表当前源码仍能被最新 builder 接受。新 Metal builder 在解析阶段直接拒绝 Dockerfile 的 `VOLUME` 指令，应用构建甚至尚未开始；部署验收必须覆盖平台当前 builder，不能只依赖历史成功记录。
2. `VOLUME /data` 只是镜像元数据，不会替代平台卷配置，也不是 `docker -v ...:/data` 生效的前提。移除它不改变 `TB_DATA_DIR=/data`、目录权限或外部挂载语义，却恢复 Railway 构建兼容性。
3. 生产切流前保留旧实例很重要。本次首次上传失败停在 build 阶段，旧实例持续健康；修复镜像并完整本地构建后再重试，没有为追求速度牺牲可回滚性。
4. 健康版本与搜索数据是两份证据。Cloudflare Worker 已报告新 gateway 版本，但真实搜索为空；继续查看树后确认手机节点已离线/回收，索引没有可索引的注册工具。这不能误报为 schema v4 重建故障，也不能把缺数据写成搜索验收通过。

## 提升

- Railway 的 `VOLUME` 限制与运行时卷责任进入 `guides/docker-host.md`。
- 同一指南中残留的旧 FTS/全 AND 描述同步改为 search v4 的共享 LIKE/ILIKE、部分命中与 path 加权语义。
