# Linux 设备 daemon

`tb daemon` 是 Linux 本机设备连接的生命周期入口，适用于需要在 SSH 退出、网络闪断或机器重启后继续在线的设备。它当前只支持 systemd user service。

## 前置条件

- 以实际运行设备连接的普通 Linux 用户执行；禁止使用 `sudo tb daemon ...` 或 root 用户。
- 先准备只允许目标设备路径 `register` 的最小权限 Device SK；不要复用 Admin SK。
- `install` 与前台 `tb connect` 共用网关、设备、shell 和文件系统暴露参数。Shell 默认不允许命令，只有显式 `--allow` 的命令可执行。
- `--allow '*'` 会按该 Linux 用户的权限开放任意远程 shell 命令。交互终端必须二次确认；非交互环境必须显式传 `--yes`。

## 安装或更新

```sh
tb daemon install \
  --device-id build-01 \
  --path device/build-01 \
  --allow git \
  --allow npm
```

`install` 会：

1. 把当前解析出的网关、SK、设备标识与 expose 配置冻结到 daemon 专用配置。
2. 将配置写入权限为 `0600` 的独立文件；systemd unit 和进程 argv 只引用配置路径，不包含 SK。
3. 安装并启用 systemd user service，同时启用 login linger，使服务不依赖 SSH 登录会话。
4. restart 服务，并等待当前配置 revision 对应的设备连接进入 `ready` 后才成功返回。

重复执行 `install` 是更新操作：即使服务已经 active，也会 restart，让新配置立即生效。安装、启动或等待 ready 失败时，会恢复安装前的配置、状态和 unit；此前已有服务时还会尝试恢复旧服务。

启用 linger 可能需要一次管理员权限。交互安装只会为固定的 `loginctl enable-linger <user>` 操作请求 sudo；不要因此用 sudo 运行整个 `tb daemon` 命令。非交互安装无法启用 linger 时，会给出需要管理员执行的固定命令。

## 日常管理

```sh
tb daemon status
tb daemon logs --follow
tb daemon restart
tb daemon uninstall
```

- `status` 同时报告 unit 是否已安装、是否 enabled/active，以及当前 revision 的连接状态。
- `logs` 从该用户的 systemd journal 读取日志；可用 `--lines <n>` 控制已有行数，`--follow` 持续跟随。
- `restart` 会等待设备重新进入 `ready` 后返回。
- `uninstall` 会停用并删除本机 unit、daemon 配置和状态文件；重复执行安全。

`uninstall` 不删除 `tb login` profile，也不吊销服务端 SK。弃用设备时必须另行在服务端吊销对应 Device SK。

## 验证边界

本地自动化测试应覆盖：

- unit 使用绝对 CLI 入口、启用自动重启，且 unit 与 argv 不含 SK；
- daemon 配置权限为 `0600`；
- linger、systemd user enable/restart/status/logs/uninstall 的命令语义；
- install/restart 以当前 revision 的 `ready` 为成功条件，错误或超时会失败；
- 重复 install 会 restart，失败更新会恢复旧文件与旧服务；
- 非 Linux、root 或 sudo 调用被拒绝，`--allow '*'` 需要明确确认；
- uninstall 不修改登录 profile，也不承担服务端 SK 吊销。

这些 stub 测试不能证明真实发行环境中的 systemd user bus、linger 跨注销/重启行为、journal 权限或真实网关 WebSocket 注册。需要该级别保证时，应在目标 Linux 发行版上以普通用户完成一次真实安装，退出 SSH 或重启后再检查 `tb daemon status` 和服务端设备状态；真实外部资源验证仍遵守每轮最多一次的项目约束。

## 实现真源

- `packages/cli/src/commands/daemon.ts`：公共命令树、参数确认与输出。
- `packages/cli/src/daemon.ts`：systemd unit、私有配置、linger、ready 等待、回滚及生命周期实现。
- `packages/cli/src/commands/connect.ts`：daemon install 与前台 connect 共用的设备连接参数解析。
- `packages/cli/test/daemon.test.ts`：本地生命周期与安全边界测试。
