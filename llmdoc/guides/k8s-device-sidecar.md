# Guide:k8s 设备边车(k8s-device-sidecar)

> 用途:把阿里云 ACK / 任意 k8s 里的 pod,在部署时反向注册到 HTBP 树的 `device/` 下,部署即被 tool-bridge 发现。镜像见 [`packages/cli/Dockerfile`](../../packages/cli/Dockerfile),发布见 [`.github/workflows/publish-agent.yml`](../../.github/workflows/publish-agent.yml)。设备协议本身见 [docker-host.md](./docker-host.md) 的「设备断线回收」段。

## 一句话原理

`tb login` 只把凭证写进本地 profile,**不注册任何设备**;`tb connect` 才开一条常驻 WebSocket(`/system/device/ws`)把本机 shell/fs 挂到 `device/<device-id>`,进程活着 = 节点在树上,进程退出 = 网关回收(DO alarm / `sweepOrphans`)。所以让 pod「部署即被发现」= 在 pod 里常驻一个 `tb connect`。

k8s 里的干净做法:**tb-agent 边车容器**,与业务容器同 pod、独立进程跑 `tb connect`,业务容器零改动。

## 镜像

`ghcr.io/tokenrollai/tool-bridge/tb-agent`(多阶段从 monorepo 构建,CLI 版本 == 网关版本)。

```bash
docker build -f packages/cli/Dockerfile -t tb-agent .
docker run --rm -e TB_BASE_URL=https://tool-bridge.example.com -e TB_SK=tbk_... \
  tb-agent connect --device-id demo --allow echo
```

`ENTRYPOINT=["tini","--","tb"]`、`CMD=["--help"]`:裸跑打印帮助;实际用 `args`/命令行覆盖成 `connect ...`。tini 作 PID1 转发 SIGTERM(触发 WS 优雅关闭,节点即时下线)并回收 shell 子进程僵尸。

## 三条铁律(否则踩坑)

1. **别把 admin SK 塞进 pod。** 签一个只能注册到某前缀的受限 SK,泄漏也越不了界(`registerPaths`):
   ```bash
   tb sk create --owner device:myapp \
     --scope 'device/myapp/**:read,call' \
     --register-path device/myapp
   ```
2. **device-id 用 Downward API 注入 pod 名。** `tb connect` 默认拿 `os.hostname()` 当 id;多副本时 pod 名唯一且随部署变化——pod 死 → WS 断 → 网关自动回收孤儿节点,不留僵尸。要固定路径(单实例)就显式 `--path device/myapp`。
3. **凭证走 env**,`connect` 读 `TB_BASE_URL`/`TB_SK`,无需 `tb login`。

## 可直接 apply 的清单

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tool-bridge
type: Opaque
stringData:
  TB_BASE_URL: "https://tool-bridge.example.com"
  TB_SK: "tbk_..."                    # 上面 tb sk create 生成的受限 SK
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  replicas: 2
  selector: { matchLabels: { app: myapp } }
  template:
    metadata: { labels: { app: myapp } }
    spec:
      containers:
        # ── 业务容器,原样不动 ──
        - name: app
          image: your-app:latest

        # ── 原生 sidecar(k8s 1.29+):先于业务就绪、晚于业务终止,优雅下线 ──
        - name: tb-agent
          image: ghcr.io/tokenrollai/tool-bridge/tb-agent:latest
          args:
            - "connect"
            - "--device-id"
            - "$(POD_NAME)"             # 每 pod 唯一,自动回收
            - "--no-shell"              # 纯 fs 暴露示例;要 shell 见下
            - "--fs"
            - "/data"
            - "--fs-readonly"
            # 暴露 shell:删掉 --no-shell,换白名单(默认拒绝一切):
            # - "--allow"
            # - "git"
          env:
            - name: POD_NAME
              valueFrom: { fieldRef: { fieldPath: metadata.name } }
          envFrom:
            - secretRef: { name: tool-bridge }
          volumeMounts:
            - { name: data, mountPath: /data }
      volumes:
        - { name: data, emptyDir: {} }
```

> **原生 sidecar(推荐,k8s ≥1.29)**:把 `tb-agent` 移到 `initContainers` 并加 `restartPolicy: Always`,它会先于业务容器就绪、晚于业务容器终止,SIGTERM 时 WS 正常关闭、节点即时下线,而非等网关 alarm 回收。放在 `containers` 下(如上)则是普通边车,行为也可用,只是终止顺序不保证。

## 排障

- **UI 里看不到节点** → 确认边车在跑 `connect` 而非只 `login`;`kubectl logs <pod> -c tb-agent` 应有 `connected <id> -> device/<id>`。
- **401/403** → SK 被网关拒或 scope 不含 `register`;用 `tb sk create ... --register-path device/<prefix>` 重签。
- **节点残留** → device-id 用了固定值且旧 pod 未优雅退出;改用 `$(POD_NAME)` 或切原生 sidecar。
