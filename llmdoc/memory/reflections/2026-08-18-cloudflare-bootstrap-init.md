# 反思：Cloudflare 首次引导必须把信任根放进部署事务

## 背景

原有 Workers 安全语义是正确的：新实例缺 `TB_BOOTSTRAP_ADMIN_SK` 就 fail closed，不能让“第一个访问者成为管理员”。但用户路径把关键动作放错了时间：README 要用户先执行 `wrangler secret put`，而全新 Worker 尚不存在时该命令会失败；Deploy Button 也没有声明 secret 输入，所以所谓“一键部署”实际会得到一个无法引导的实例。`/healthz` 又不代表 bootstrap 完成，进一步放大了误判。

## 本轮结论

1. **信任根必须属于首次部署事务。** 新实例用 `wrangler deploy --secrets-file` 在创建 Worker 的同一次 deploy 中注入 Admin SK 与 SecretStore 主密钥；Deploy Button 用 `.dev.vars.example` 在构建前收集同样两项。不能把 `secret put` 设计成“部署后的补丁”。
2. **初始化便利性不能改写所有权模型。** 不增加公网 claim/setup 路由，不引入“首访者获 admin”。既有同名 Worker 必须先用本机 profile 的 Admin SK 验证成功；向导永不生成或覆盖它的 bootstrap Admin SK。
3. **秘密不进 argv。** 向导在内存生成 32-byte base64url 随机值，只写进 mode 0600 的系统临时文件，把文件路径交给 Wrangler，结束后删除。Admin SK 在部署成功后写入 mode 0600 的 XDG profile，并向人类仅显示一次。
4. **重入先读后写。** 先用 `wrangler secret list --format json` 判断 Worker 是否存在并读取 secret 名称；任何鉴权/解析错误都 fail closed。既有实例若缺 SecretStore 主密钥，只补该项，`--secrets-file` 不包含 bootstrap Admin SK。
5. **无自定义域必须有确定入口。** provision 在 `TB_DOMAIN` 为空时主动设 `workers_dev:true` 并清空旧 routes；有域名时设 `workers_dev:false` 并写 custom-domain route。不能让中立仓库的 `workers_dev:false` 泄漏成“部署成功但无 URL”。

## 调试中暴露的文档与验证缺口

- 一开始只看模板源码会误以为 Deploy Button 可用；把 `template/` 复制到全新临时目录做 `npm install → tsc → wrangler deploy --dry-run` 后，才发现宽松的 Wrangler 版本范围解析到 4.123，而旧 4.x workers-types 造成 peer conflict。模板依赖组合必须以隔离安装验证，monorepo 本身全绿不能替代。
- Cloudflare 官方 Deploy Button 已支持从 `.dev.vars.example` / `.env.example` 收集 Worker secrets，并支持在 `package.json.cloudflare.bindings` 提供说明。若文档仍教用户部署后 `secret put`，就是没有把平台现有能力纳入初始化设计。
- `pnpm verify` 不执行发布 build，也不会安装隔离的 `template/` 子项目。CLI 新能力仍须 fresh build、版本字符串与 pack 检查；模板另需隔离 dry-run。

## 提炼去向

- `guides/deploy-and-verify.md`：新增全新账户的 Deploy Button / `tb init cloudflare` 路径、秘密与重入边界。
- `architecture/modules-and-boundaries.md`、`architecture/code-map.md`：CLI 不再是绝对“纯 API 客户端”，初始化编排是明确的本地/Cloudflare 例外。
- `must/current-state.md`：记录 CLI 0.16.0、模板 secret 收集、provision workers.dev 行为与尚未真实部署/发布的证据边界。
