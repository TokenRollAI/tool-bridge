# 公共站点自动发布与文档切页性能反思

## 任务结论

首次诊断时，站点仓库具备 Direct Upload 工作流，但 GitHub 仓库没有配置 `CLOUDFLARE_ACCOUNT_ID` 与 `CLOUDFLARE_API_TOKEN`，因此工作流只完成验证并安全跳过上传。后续站点改为 Cloudflare Pages Git Integration，并以 `toolbridge.tokenroll.ai` 作为线上入口；当前发布方式以 `overview/project-overview.md` 为准。

文档切页慢也不是 MDX 内容量或浏览器渲染造成的。当前 Starlight 站点是静态多页应用，站内链接会请求下一页完整 HTML；哈希 CSS/JS 已长期缓存，实测慢样本的大部分时间耗在 HTML 首字节。Starlight 已默认在 hover 后预取链接，不能把“再打开 prefetch”当作根治方案；当前 `pages.dev` 预览访问路径出现了明显网络抖动，预取完成后同类切页显著变快。

## 过程中暴露的问题

- “CI 绿色”同时可能表示“验证成功、部署因缺 Secret 被安全跳过”。发布验收必须检查实际部署步骤与 URL。
- Pages Direct Upload 和 Pages Git integration 是两套交付 ownership。已有 Wrangler CI 时不应再把同一项目连接到 Git integration，否则会形成双重部署入口。
- 单次 LCP 数字不是稳定 SLA。性能诊断应拆出 HTML TTFB、渲染延迟和静态资产缓存，并用 canonical 自定义域名复测。
- 当前 HTML 返回 `max-age=0, must-revalidate`。短 TTL 能改善回访但会引入发布后的浏览器陈旧窗口；ClientRouter 能减少整页重建的视觉割裂，但仍需获取目标 HTML。这两项都应在真实域名基线之后按证据选择。

## 已吸收的稳定知识

- 自动发布的凭证闸门、绿色 run 的验收边界和静态多页性能基线已提升到 `overview/project-overview.md`。
- Cloudflare token 只授予目标账户的 `Cloudflare Pages: Edit`；不要把本机 Wrangler OAuth token、API token 或 account ID 写入源码和 llmdoc。
- 优化顺序是先绑定并测试 canonical 域名，再评估更激进的预取、短 HTML TTL 或 ClientRouter，避免在网络基线未知时叠加复杂度。
