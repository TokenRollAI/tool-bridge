# foundation · Tool Bridge V1 统一设计语言与共享组件库

`design/foundation/tool-bridge.lib.pen` 承载 Tool Bridge **Web Dashboard**（`packages/dashboard`）与 **Mobile App**（`tool-bridge-mobile`）共享的 **Obsidian 双层中性表面、单色高对比主操作、稀缺琥珀金信号预算（Dark / Light 双主题同源）、圆角与字体刻度，以及 20 个 `TB/*` 可复用组件**。

---

## 接入约定（Pen CLI `import_library`）

下游画板文件（`design/dashboard/web-dashboard.pen`、`design/mobile/mobile-app.pen`）通过 `import_library({ path: "/Users/djj/repos/tool-bridge/design/foundation/tool-bridge.lib.pen" })` 导入本库，默认别名为 **`t`**（保存后自动生成相对路径 `"imports": { "t": "../foundation/tool-bridge.lib.pen" }`）：

- **引用变量**：`"$t:--bg-canvas"`、`"$t:--ink"`、`"$t:--signal"`、`"$t:--r-md"`、`"$t:--font-sans"`、`"$t:--font-mono"`
- **切换主题轴**：默认暗色；在画板或局部容器上设置 `theme: { "t:mode": "light" }` 即可切换为浅色模式
- **实例化组件**：
  ```js
  btn = Insert(parent, {
    type: "ref",
    ref: "t:n8TGyY",
    name: "Invoke Button",
    descendants: {
      "t:hhEqK": { icon: "play" },
      "t:g8t2B": { content: "调用命令" }
    }
  })
  ```
- **注意**：跨库实例的 `descendants` 键必须带库别名前缀（如 `"t:g8t2B"`，裸 ID 会被 Pen CLI 忽略）。为确保导入别名稳定为 `t`，新建页面文件时以包含 `"imports": { "t": "../foundation/tool-bridge.lib.pen" }` 的空文档作为 `--in` 起点再通过 Pen CLI 编辑保存。要隐藏某个可选子节点（如图标或未读点），传 `{ enabled: false }`，不可对实例内部节点调用 `Delete`。

---

## 核心设计铁律

1. **最多两层主表面 + 悬浮 Slab**：同屏仅使用 `Stage ($t:--bg-stage)`（导航栏、Inspector 抽屉、移动端设置分组）+ `Canvas ($t:--bg-canvas)`（主工作流、信箱阅读流、能力树底面）；临时浮层使用 `Slab ($t:--bg-slab)`。严禁卡片套卡片描边。
2. **唯一实底主动作 + 稀缺琥珀金信号**：每个视图最多一个单色高对比主按钮（`$t:--ink` 底 + `$t:--on-ink` 字）；顶栏全局辅助动作使用次级按钮（`$t:--tone-soft`）。琥珀金 `$t:--signal`（Dark `#F5C451` / Light `#8A5A00`，对比度均 >= 5.49:1）仅用于：**当前画布节点选区、未读消息圆点、等待人工确认门禁、键盘 `:focus-visible` 焦点环**；侧栏激活项只用中性 `$t:--tone-muted` 与字重区分。
3. **字阶与间距基准**：
   - 页标题 `24 / 1.35 (600)` · 区标题 `16 / 1.5 (600)` · Web 正文 `14 / 1.55` · Mobile 正文 `16 / 1.5` · 技术等宽 `13 / 1.5` · 辅助说明 `12 / 1.5`。
   - 间距阶梯：`4 · 8 · 12 · 16 · 24 · 32`。触控高度：Web 紧凑控件 `36px`，390px 窄屏与原生触区 `>= 48px`。

---

## UI Token 变量表（32 Variables）

| 变量引用（带 `t:`） | Dark（默认） | Light | Web (`index.css`) 映射 | Mobile (`theme.ts`) 映射 | 用途 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `$t:--bg-canvas` | `#09090B` | `#FFFFFF` | `--background` | `background` | 主工作面、信箱阅读流、能力树画布 |
| `$t:--bg-stage` | `#101013` | `#F6F6F8` | `--panel` / `--rail` | `panel` | 侧栏、NodeInspector 抽屉、移动端分组块 |
| `$t:--bg-slab` | `#16161A` | `#FFFFFF` | `--popover` / `--card` | `slab` | CommandPalette、Dialog、ActionSheet、胶囊底栏 |
| `$t:--bg-elevated` | `#1E1E24` | `#EEEEF2` | `--panel-raised` | `panelElevated` | 控件局部槽位或按下态（不做第三层卡片） |
| `$t:--ink` | `#F4F4F6` | `#09090B` | `--foreground` / `--primary` | `text` / `primary` | 主文字、单色主按钮填充 |
| `$t:--on-ink` | `#09090B` | `#FFFFFF` | `--primary-foreground` | `onPrimary` | 单色主按钮文字、开态开关滑块（>= 18.1:1） |
| `$t:--ink-2` | `#B4B4BC` | `#52525B` | `--muted-foreground` | `muted` | 次级正文、常规导航、活跃输入占位符（>= 4.5:1） |
| `$t:--ink-3` | `#8A8A94` | `#686872` | `--color-ink-3` | `mutedSubtle` | 时间戳、表头标签、路径分隔（>= 4.58:1） |
| `$t:--ink-4` | `#585862` | `#9E9EA8` | disabled text | — | 仅限禁用态，禁止作活跃输入框占位符 |
| `$t:--tone-subtle` | `#141418` | `#F7F7F9` | `--color-tone-subtle` | — | 行悬停、代码块与 CLI Hint 底槽 |
| `$t:--tone-soft` | `#1E1E24` | `#EFEFF3` | `--secondary` / `--muted` | `primarySoft` | 次级按钮、搜索框底槽、分段器轨道 |
| `$t:--tone-muted` | `#292932` | `#E4E4EA` | `--accent`（中性） | — | 激活侧栏项、选中筛选胶囊 |
| `$t:--edge-subtle` | `#242429` | `#E4E4E8` | `--border` | `border` | 单边区域分界线、表格细横线、浮层描边 |
| `$t:--edge-strong` | `#383842` | `#D4D4DC` | `--color-edge-strong` | — | 画布节点默认描边、装饰强分界 |
| `$t:--outline` | `#8C8C96` | `#6D6D78` | `--input`（实线边界） | `outline` | 输入框/开关可达轮廓（>= 4.4:1） |
| `$t:--signal` | `#F5C451` | `#8A5A00` | `--ring` / `--color-signal` | `signal` | 节点选区边框、未读点、待确认锚点、键盘焦点环 |
| `$t:--signal-soft` | `#2A2210` | `#FFF4D1` | `--color-signal-soft` | `signalSoft` | 信号胶囊底色 |
| `$t:--ok` / `$t:--ok-soft` | `#6EE7A8` / `#13291E` | `#146C43` / `#E8F6EE` | `--ok` / `--color-ok-soft` | `success` / `successSoft` | 在线会话、网关健康、执行成功 |
| `$t:--warn` / `$t:--warn-soft` | `#F5C451` / `#2A2210` | `#8A5A00` / `#FFF4D1` | `--warn` / `--color-warn-soft` | `warning` / `warningSoft` | 疑似失联、`result_unknown` 不可盲重试、直调提醒 |
| `$t:--danger` / `$t:--danger-soft` | `#FF9DA6` / `#381D23` | `#B92534` / `#FFF0F2` | `--destructive` / soft | `danger` / `dangerSoft` | 离线错误、吊销、紧急停用 |
| `$t:--on-danger` | `#2B0B12` | `#FFFFFF` | `--destructive-foreground` | `onDanger` | 危险实底按钮文字（>= 6.2:1） |
| `$t:--info` / `$t:--info-soft` | `#7DD3FC` / `#12283A` | `#0369A1` / `#E8F4FD` | `--info` / `--color-info-soft` | — | 协议与联邦来源信息 |
| `$t:--scrim` | `#000000B8` | `#09090B73` | backdrop | backdrop | 模态遮罩 |
| `$t:--r-xs` / `$t:--r-md` / `$t:--r-panel` / `$t:--r-dialog` / `$t:--r-pill` | `4` / `8` / `14` / `20` / `9999` | 同左 | radius tokens | radius tokens | 键帽(4) · 按钮/输入/导航(8) · 节点/分组(14) · 浮层(20) · 胶囊(9999) |
| `$t:--font-sans` / `$t:--font-mono` | `IBM Plex Sans` / `IBM Plex Mono` | 同左 | `--font-sans` / `--font-mono` | 系统无衬线 / 等宽 | UI 正文与技术标识符 |

---

## `TB/*` 可复用组件 ID 清单（20 Components）

| `ref`（含 `t:`） | 组件名 | 尺寸/布局 | 可覆盖子节点 ID（`descendants` keys） |
| :--- | :--- | :--- | :--- |
| `"t:UQ2uA"` | `TB/Brand/Mark` | `28×28` | `"H2nH9n"` (Bridge Vector `path`) |
| `"t:n8TGyY"` | `TB/Action/Primary` | `h:36` 水平 | `"hhEqK"` (Icon `lucide`), `"g8t2B"` (Label `text`) |
| `"t:v4yXWZ"` | `TB/Action/Secondary` | `h:36` 水平 | `"iIttw"` (Icon `lucide`), `"JCdiF"` (Label `text`) |
| `"t:ZM7KP"` | `TB/Action/Ghost` | `h:36` 水平 | `"imQJP"` (Icon `lucide`), `"yFe7I"` (Label `text`) |
| `"t:MxP2g"` | `TB/Action/Danger` | `h:36` 水平 | `"V9yU7"` (Icon `lucide`), `"P7dpRb"` (Label `text`) |
| `"t:XwOdh"` | `TB/Action/Icon` | `36×36` | `"VqZIV"` (Icon `lucide`) |
| `"t:HFR5g"` | `TB/Status/Online` | pill | `"u1uh9"` (Dot), `"lYSle"` (Label `text`) |
| `"t:c4H7uT"` | `TB/Status/Caution` | pill | `"iWMlp"` (Dot), `"seNnr"` (Label `text`) |
| `"t:o0io3"` | `TB/Status/Danger` | pill | `"kGPXN"` (Dot), `"ziEjf"` (Label `text`) |
| `"t:Fcngm"` | `TB/Status/Neutral` | `r:4` tag | `"DwQ3X"` (Label `text`) |
| `"t:U6sUGR"` | `TB/Field/SearchTrigger` | `340×36` | `"G6ZsV"` (Icon), `"rpZOx"` (Placeholder), `"VyAZm"` (Keycap frame), `"kACWQ"` (Shortcut text) |
| `"t:gEPFw"` | `TB/Field/Input` | `w:320` 垂直 | `"ECxPJ"` (Label), `"WMSlO"` (Box frame), `"L8Yg4"` (Value text), `"mkGUH"` (Hint text) |
| `"t:Tb8M3"` | `TB/CodeLine` | `460×38` | `"d7o5Im"` (Code text), `"rf5eS"` (CopyIcon) |
| `"t:ZxeO7"` | `TB/NavItem/Active` | `196×36` | `"GAsHb"` (Icon), `"f4xge"` (Label) |
| `"t:hErNH"` | `TB/NavItem/Default` | `196×36` | `"cZCdT"` (Icon), `"C2z0l"` (Label) |
| `"t:RGr7h"` | `TB/CanvasNode/Default` | `w:272` | `"MDoyF"` (PresenceDot), `"VVZXa"` (NodeName), `"k4Ke2z"` (NodeDesc), `"j9zD3V"` (NodeMeta), `"S67at"` (ExpandIcon) |
| `"t:GAUfx"` | `TB/CanvasNode/Selected` | `w:272` | `"Hooey"` (PresenceDot), `"AY17f"` (NodeName), `"A19QNB"` (NodeDesc), `"OgULI"` (NodeMeta), `"c3iEI"` (ExpandIcon) |
| `"t:b5C6i"` | `TB/Mobile/StatusBar` | `390×48` | `"bc9R4"` (Time), `"bsXaq"` (Wifi), `"KCl4E"` (Battery) |
| `"t:mWsTx"` | `TB/Mobile/CapsuleTabBar` | `342×56` | `"hnkZr"` (TabInbox frame), `"wKzGQ"` (InboxIcon), `"GohUl"` (InboxLabel), `"q2mVkG"` (UnreadDot), `"b63Fo"` (TabDevice frame), `"TLEFc"` (DeviceIcon), `"jteTH"` (DeviceLabel) |
| `"t:lhQBb"` | `TB/Feedback/Caution` | `w:520` | `"c1xqR6"` (Icon), `"HvL0F"` (Title), `"f98kTH"` (Body) |
