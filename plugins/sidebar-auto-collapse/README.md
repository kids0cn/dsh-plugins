# sidebar-auto-collapse

侧边栏自动折叠 + 悬停展开的 DSH 插件（自研，未发布到 npm）。

## 功能

- **设置 → 通用 →「自动收起左侧栏」** 开关（注册在 `settings.general.item`，`order: 20`）
- 开启后左栏自动折叠成 56px 窄条；鼠标移到栏上自动展开，移开约 160ms 后自动收起
- 偏好存 `localStorage['dsh.sidebar.autoCollapse']`（浏览器级，刷新保留）
- 侧栏底部注册一个零高度锚点 span（`sidebar.footer.action`，`order: 1000`）：
  既拿宿主的 `wide` 状态，又给命中判定当定位标记；它的 `data-asc` 属性挂着
  控制器快照（`enabled / inside / wide / note`），排查时直接读它。

## 安装

```bash
dsh plugin --profile web add /绝对路径/dsh-plugins/plugins/sidebar-auto-collapse
```

装完重启 `dsh-web`（HMR 不看源码）。

## 实现要点（踩过的坑）

1. **命中判定不能往上爬祖先**：`element.contains(anchor)` 找"第一个同时包含锚点的祖先"，
   而 **frame 同时是左栏和中栏的祖先** → 中栏上的任何目标都判成"在栏内" → **移出永不收起**。
   改成用锚点的横向范围（列满高、贴左）：`clientX <= anchor.right + 16`，并排除模态遮罩。
2. **不能等宿主的 `wide` 追平**：它在收起方向滞后 150ms，等它会卡出 400ms 死区，
   悬停反向一顿一顿。改成**目标态对账**：自己 toggle 后先记目标，`wide` 只用来确认现实。

## 验证

```bash
node --check client.js && node test/selftest.mjs   # 27 项，含 frame 陷阱 fixture
```

真机用 agent-browser 纯 JS eval 采样（15ms/次读 `getComputedStyle` 列宽）：
悬停进 **11–29ms**、悬停出 **171ms**、过渡中途反向即时生效。

## 上游

功能正常后**仍没有过渡动画** —— 宿主自己的按钮也是一帧切（`ui-layout` 的
`data-animating` 与 `grid-template-columns` 同提交，transition 晚一步，只有 600ms
窗口内的第二次变化才插值）。实测数据与两套修法：

- [harness Discussions #8882](https://github.com/deepseek-ai/deepseek-harness/discussions/8882)
- 原文见本目录 `UPSTREAM-issue-ui-layout-animation.md`
