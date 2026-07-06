# Phase 0 Bootstrap 反思(Round 1-2,2026-07-06)

> 范围:llmdoc init + CF 资源 provision + smoke 验证。以下五条均已核实,按"教训 → 下轮怎么做"记录。

## 1. scratch report 会丢

`.llmdoc-tmp/investigations/v1-reference-map.md` 在 init 过程中一度从磁盘消失(原因未查明,疑与并行 subagent 有关),靠原调查者(仍在上下文里)重写恢复。recorder 曾把缺失误记成 doc-gaps G6"v1 未检索",与事实矛盾。

**下轮怎么做**:scratch 报告产出后尽快内化进 llmdoc 稳定文档;主协调者收到报告先确认文件存在再派 recorder;recorder 引用报告前自查存在性,发现缺失应上报,而不是默默记成"未产出"。

## 2. 后台 subagent 的等待方式

spawn 的后台 agent 不在 TaskList 里,TaskOutput 也查不到。

**下轮怎么做**:派 agent 时就约定精确的产出文件路径;等待时轮询该文件(存在 + 大小稳定)或等 task-notification。

## 3. 多账户 wrangler 必须显式指定账户

本机 OAuth 有两个 CF 账户,任何直接跑 wrangler 的命令都必须显式 `CLOUDFLARE_ACCOUNT_ID`(或在 wrangler.jsonc 写 `account_id`),否则非交互模式直接报错。provision 脚本已内置,手跑命令时容易忘。

**下轮怎么做**:手跑 wrangler 一律带 `CLOUDFLARE_ACCOUNT_ID=...` 前缀,或确认 wrangler.jsonc 已写 account_id。

## 4. 权限疑虑用真实操作核实

此前 whoami 输出截断,导致"未确认 R2 write 权限"的疑虑;实测 `wrangler r2 bucket create` 成功,权限完备。

**下轮怎么做**:与其翻 whoami 权限清单,不如直接做一次幂等的真实操作来验证权限。

## 5. smoke 脚本不读 .env

首次直跑 smoke 失败一次:脚本不读 .env,需显式 `TB_BASE_URL=... pnpm smoke`。属可改进项(非缺陷)。

**下轮怎么做**:跑 smoke 时显式传 TB_BASE_URL;或后续让脚本支持读 .env。

## Promotion Candidates

- 第 3、5 条属于稳定操作事实,若反复用到,可由 recorder 提升进 guides/(部署排错或本机跑法一篇)。
