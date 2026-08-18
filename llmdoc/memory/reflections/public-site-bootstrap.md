# 公共站点独立仓库与 CI 启动反思

## 任务结论

公共首页和用户文档适合独立于 tool-bridge monorepo：它们有不同的发布节奏、依赖图和受众，也不应把面向编码 agent 的 llmdoc 直接公开。独立站点已用 Astro + Starlight 建立，公共叙事明确服从代码和实例运行时契约。

## 过程中暴露的问题

- 只在已有工作区运行一次成功构建，不足以证明新仓库的 CI 可复现。第一次 GitHub Actions 在干净 runner 的安装阶段失败，因为 pnpm 11 默认阻止 `esbuild` 和 `workerd` 的构建脚本。
- 新仓库暂存在父 monorepo 目录内时，pnpm 会向上发现父级 workspace。独立仓库需要自己的 `pnpm-workspace.yaml`，同时用 `allowBuilds` 显式列出被锁定且确实需要运行安装脚本的原生依赖。
- 新建工作流若沿用旧 Action 主版本，即使能运行也会立即产生 Node runtime 弃用告警和一批 Dependabot PR。首次落库前应通过官方 release 校验当前受支持主版本。

## 已吸收的稳定知识

- 公共文档 ownership、运行时真源优先级和平台配置边界已提升到 `overview/project-overview.md`。
- 干净环境构建脚本许可与当前 Action 版本属于站点仓库自身的可执行配置，不复制进 tool-bridge 的部署 guide。
- Cloudflare 凭证、Pages project 和域名绑定仍是用户后续的平台配置；未获授权时，CI 应完成验证并明确跳过上传，而不是暗中创建云资源。

