# 在 Container 中使用完整 `tb` CLI

官方镜像是 `ghcr.io/tokenrollai/tool-bridge-cli`，其中包含全部 `tb` 子命令，不需要 Node.js 或
Bun。正式版本使用明确的版本标签；`latest` 跟随最近一次正式发布，`edge` 只用于合入前预览。

镜像同时支持 Linux amd64 和 arm64，入口是 `/usr/local/bin/tb`，默认以非 root 用户
`10001:10001` 运行。

## 快速开始

本轮可直接使用的预览标签是 `edge`；正式发布后请把它替换为明确版本，避免生产环境静默升级：

```sh
export TB_CLI_IMAGE=ghcr.io/tokenrollai/tool-bridge-cli:edge
docker pull "$TB_CLI_IMAGE"
docker run --rm "$TB_CLI_IMAGE" --version
docker run --rm "$TB_CLI_IMAGE" --help
```

一次性访问 Tool Bridge Server 时，推荐通过环境变量传入目标和 SK：

```sh
docker run --rm \
  -e TB_BASE_URL=https://tobridge.example.com \
  -e TB_SK="$TB_SK" \
  "$TB_CLI_IMAGE" status --json

docker run --rm \
  -e TB_BASE_URL=https://tobridge.example.com \
  -e TB_SK="$TB_SK" \
  "$TB_CLI_IMAGE" tree --depth 2

docker run --rm \
  -e TB_BASE_URL=https://tobridge.example.com \
  -e TB_SK="$TB_SK" \
  "$TB_CLI_IMAGE" \
  call tools/example/ping '{}'
```

`--base-url`、`--sk` 和 `--json` 也可以写在命令行中。生产环境不要把 SK 写进镜像、
Dockerfile 或 Pod 清单明文；应使用 Docker Secret、Kubernetes Secret 或运行平台的密钥注入能力。

## 持久化登录配置

`tb login` 把 profile 写入 `$XDG_CONFIG_HOME/tool-bridge/config.json`；镜像中的默认配置根目录是
`/home/tb/.config`。使用 Docker volume 后，后续容器可以复用登录信息：

```sh
docker volume create tb-cli-config

docker run --rm -it \
  -v tb-cli-config:/home/tb/.config \
  "$TB_CLI_IMAGE" \
  login --base-url https://tobridge.example.com --sk "$TB_SK"

docker run --rm \
  -v tb-cli-config:/home/tb/.config \
  "$TB_CLI_IMAGE" whoami
```

在自动化环境中通常直接使用 `TB_BASE_URL` 和 `TB_SK`，不必先执行 `tb login`。

## 作为常驻 Device 运行

`tb connect` 是前台长驻进程：CLI 内部负责 WebSocket 心跳和网络闪断后的自动重连，Docker 或
Kubernetes 负责进程异常退出后的重新拉起。容器内不需要再运行第二个守护进程。

下面把宿主机的 `./shared` 只读挂载为 Device 文件系统，并只允许远程执行 `uname` 和 `ls`：

```sh
docker run -d \
  --name tb-device \
  --restart unless-stopped \
  -e TB_BASE_URL=https://tobridge.example.com \
  -e TB_SK="$TB_DEVICE_SK" \
  -v "$PWD/shared:/workspace:ro" \
  "$TB_CLI_IMAGE" \
  connect \
    --device-id build-01 \
    --path device/build-01 \
    --allow uname \
    --allow ls \
    --fs /workspace \
    --fs-readonly
```

常用运维命令：

```sh
docker logs -f tb-device
docker restart tb-device
docker stop tb-device
```

安全建议：

- 为每个实例使用唯一的 `--device-id` 和 `--path`。
- Device SK 只授予所需的注册路径和动作。
- 使用重复的 `--allow <command>` 建立最小 Shell 白名单；`--allow '*'` 只适用于完全可信机器。
- 不需要 Shell 时使用 `--no-shell`。
- 只读/写入操作优先通过 `--command-profile <file>` 暴露固定 executable + argv；容器需只读挂载
  profile 文件，且启动命令应同时使用 `--no-shell`。
- 文件挂载优先使用宿主机的 `:ro` 和 CLI 的 `--fs-readonly` 双重只读限制。

## Kubernetes Sidecar

业务容器不必基于 CLI 镜像。推荐把 CLI 作为 Sidecar，并与业务容器显式共享需要暴露的 Volume：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app-with-tobridge
spec:
  containers:
    - name: app
      image: your-app:latest
      volumeMounts:
        - name: workspace
          mountPath: /workspace

    - name: tobridge
      # 生产环境请固定正式版本或 digest；edge 仅用于当前预览。
      image: ghcr.io/tokenrollai/tool-bridge-cli:edge
      args:
        - connect
        - --device-id
        - $(POD_UID)
        - --path
        - k8s/$(POD_NAMESPACE)/$(POD_UID)
        - --allow
        - ls
        - --fs
        - /workspace
        - --fs-readonly
      env:
        - name: TB_BASE_URL
          value: https://tobridge.example.com
        - name: TB_SK
          valueFrom:
            secretKeyRef:
              name: tobridge-device
              key: sk
        - name: POD_UID
          valueFrom:
            fieldRef:
              fieldPath: metadata.uid
        - name: POD_NAMESPACE
          valueFrom:
            fieldRef:
              fieldPath: metadata.namespace
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: ["ALL"]
        readOnlyRootFilesystem: true
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
      volumeMounts:
        - name: workspace
          mountPath: /workspace
          readOnly: true

  volumes:
    - name: workspace
      emptyDir: {}
```

同一个 Pod 内的容器共享网络，但不共享根文件系统。远程 Shell 运行在 `tobridge` Sidecar 中，只能
看到 Sidecar 自己的文件和双方共同挂载的 Volume。如果必须在业务容器自己的根文件系统与进程环境中
执行命令，应改用下一节的“复制二进制”方案。

仓库另有包含 Secret profile、Pod UID 和收紧后安全上下文的完整
[`kubernetes-sidecar.yaml`](./examples/kubernetes-sidecar.yaml) 示例。

## 只把二进制复制进其他镜像

不要求业务镜像 `FROM` CLI 镜像。对于 Alpine，可以使用多阶段复制：

```dockerfile
FROM ghcr.io/tokenrollai/tool-bridge-cli:edge AS tb

FROM your-app:alpine
RUN apk add --no-cache ca-certificates libgcc libstdc++
COPY --from=tb /usr/local/bin/tb /usr/local/bin/tb
```

当前官方 CLI 镜像内是 musl 二进制，适用于 Alpine。它不是完全静态链接：不能直接复制到
Debian/Ubuntu，也不能直接复制到 `scratch`。Debian、Ubuntu 或 glibc distroless 镜像应使用单独
发布的 `*-gnu` 二进制；无论使用哪一种，都要选择与节点一致的 amd64/arm64 架构，并保证系统 CA
证书可用于 HTTPS/WSS。

也可以从镜像中把二进制提取到宿主机：

```sh
container_id="$(docker create "$TB_CLI_IMAGE")"
docker cp "$container_id:/usr/local/bin/tb" ./tb
docker rm "$container_id"
chmod +x ./tb
```

提取出的文件仍遵守上述 musl、CPU 架构和运行库要求。

## 排错

- `exec ...: no such file or directory`，但文件确实存在：通常是把 musl 二进制复制进了 glibc 镜像，
  或 CPU 架构不匹配。
- HTTPS/WSS 证书错误：检查目标镜像是否安装并更新了 `ca-certificates`。
- Device 显示离线：先看 `docker logs` 或 `kubectl logs`；确认进程没有退出、SK 未过期且注册路径在
  scope 中。
- Sidecar 看不到业务文件：两个容器必须挂载同一个 Volume；Pod 内共享网络不等于共享文件系统。
- 容器重启后 profile 消失：挂载 `/home/tb/.config`，或改用环境变量注入配置。

查看所有命令和某个命令的参数：

```sh
docker run --rm "$TB_CLI_IMAGE" --help
docker run --rm "$TB_CLI_IMAGE" connect --help
docker run --rm "$TB_CLI_IMAGE" device --help
```
