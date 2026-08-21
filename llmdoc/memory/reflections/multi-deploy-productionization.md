# 反思:多副本部署产品化与 CF 发布路径合流

任务:部署形态 review → P0 正确性修复(端口/探针/引导并发/CF 路径漂移)→ Helm 与生产 compose 交付。

## 教训与发现

1. **多发布入口会静默漂移成两个产品。** Deploy Button template 曾导入 gateway 包根(零插件库入口),而源码部署走 `deployEntry.ts` 全量装配——部署出的实例没有内置集成、没有 search;template 依赖还钉在旧 minor(0.x caret 不跨 minor)。修复:发布 `@tool-bridge/gateway/full` 子路径导出,template 从 `/full` 导入。规则:源码 wrangler main、npm 导出、Deploy Button template 三处必须消费同一装配产物,改装配时同轮核对(已促成 deploy-and-verify.md 新小节)。

2. **构建坑:tsup neutral 平台 + MCP SDK。** `pkce-challenge` 的 exports 只有 browser/node 条件分支,`platform:'neutral'` 缺省条件解析必挂且报错难懂。设 esbuild `conditions: ['workerd','worker','browser']`(wrangler 同款)解决。已进 guide。

3. **给共享契约加原语时优先可选方法。** `StateStore.putIfAbsent` 做成可选:必选会破坏 SDK 消费者的自定义 store。KV 无 CAS 不实现,调用方容忍回退(get-miss→put)并保证重复写幂等。bootstrap 用 Admin SK 的 hash key 做天然去重键(同明文→同 sha256)winner-takes-all;生产 compose ha 双副本实弹验证:并发冷启动只有一条引导日志。

4. **探针三分工与关停顺序即语义。** `/livez` 恒 200(liveness 探后端会在 PG 抖动时错杀健康进程);`/readyz` 探后端+draining(摘流量);`/healthz` 版本+catalog 对拍。SIGTERM:draining→等 drain 秒数→停接新连接→终止设备 WS→关后端;顺序反了会有"设备通道已死、HTTP 还收新请求"窗口。

5. **Helm 按后端配置推断形态、渲染期 fail 危险组合。** SQLite→StatefulSet+PVC(避免 Deployment+RWO 卷滚动死锁);PG+S3→无状态 Deployment;五个危险组合(SQLite 多副本、HA 无 Redis 多副本、objectStore 半配、缺 Admin SK、standalone 开 HPA)渲染期 fail,CI 里负向用例与正向渲染同为硬闸门——"必须失败的组合真的失败"要测。

6. **流程排序:先修运行时契约再交付部署产物。** 若先出 Helm/compose,会把 /healthz 假阳性、Dockerfile `ENV TB_PORT` 摁死 PORT 兜底、引导无并发保护固化进多副本模板——多副本恰是这些 bug 的暴露场景。外部 review 结论要逐条拿代码核实再采信:几处表述过强(如"设备通道逻辑重复",实际权威判定已共享,差异只是传输层升级机制的平台事实)已降级。

7. **环境异常:Write 后文件一度消失。** 写 `deploy/helm/.../_helpers.tpl` 后文件从磁盘消失(工具报成功、ls 不见、find 时隐时现),shell heredoc 重写后稳定;复现实验未能重现。再遇 Write 后文件不见:先 stat 验证,再用 shell 重写,不盲目重试同一工具。

## 吸收去向

1/2 → guides/deploy-and-verify.md;4/5 → guides/docker-host.md;能力事实 → must/current-state.md。均已落盘,本反思吸收完成后可删。
