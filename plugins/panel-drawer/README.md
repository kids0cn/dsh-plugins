# panel-drawer — 左侧栏二级抽屉

把侧栏里**用得少但要留着**的入口收进一个二级抽屉：`sidebar.panellist` 只占一个图标，
技能中心 / 任务看板 / 上下文洞察等入口在抽屉里按需打开，原图标自动隐藏。

> 解决的问题：面板类插件装多了，左侧栏越挤越长。DSH 没有官方的"隐藏入口"配置
> （skill-explorer / task-board / dsh-context 都没有），这个插件补上这一层。

## 效果

- 侧栏只剩一个方格状 **工具抽屉** 图标（order=50，排在其余面板行之后）
- **点整行**（含回车键）弹出抽屉浮层，列出收编的入口；点空白处关闭
- 原入口按钮即时隐藏（display:none），移回侧栏即恢复
- 中英文界面都对得上（隐藏规则同时匹配双语标签）

## 通用配置（选择 / 拖动）

管理页两个入口：抽屉底部 **⚙ 管理入口…**，或 **设置 → 侧栏抽屉**。

- 两栏布局：左「留在侧栏」/ 右「抽屉内」，**HTML5 拖动**跨栏移动、栏内排序
- 每行附按钮（收进抽屉 → / ← 放回侧栏），不用拖也能操作
- 新装的面板插件会自动出现在左栏（panellist / footer.action 两个槽的实时清单，
  认不出人话标签的内部 helper 会自动过滤），拖一下即收编，**改动即时生效**
- 配置存 `localStorage`（key `dsh.panel-drawer.config.v1`），按浏览器隔离

## 工作机制

| 环节 | 做法 |
|---|---|
| 抽屉图标 | `sidebar.panellist` 注册 id=`panel-drawer`；图标尺寸**必须用槽位传入的 `props.size`**（16/18），写 100% 会撑爆整行 |
| 弹层 | 注册到 `shell.overlay`（壳的正规浮层槽），按图标 `getBoundingClientRect` 定位在侧栏右缘 |
| 整行点击 | document **捕获层**拦本行 click（`closest('button')` 含自己的 glyph → `stopPropagation` + toggle），否则点文字会掉进壳的 `selectPanel` 进管理页 |
| 打开入口 | panellist 类走 `ctx.layout.selectPanel(id)`；footer 类（无 main 面板）点原按钮 |
| 隐藏原按钮 | ① 注入 `<style>`：每条目生成 `button[aria-label="…"]` 规则；② DOM 同步兜底（`data-pd-hidden` 标记，可恢复）；③ 条目可带**稳定 selector**（如 `context-overview` = `button.lc-ov-entry`），免疫语言切换 |
| 标签解析 | CATALOG 静态元数据（双语标签 / selector）与用户配置分离——条目移出抽屉后仍可识别、可移回 |
| 管理页 | 同一组件挂 `main`（key=`panel-drawer`）和 `settings.section` 双入口 |

## 安装

```bash
# 从本仓库
dsh plugin --profile web add /绝对路径/dsh-plugins/plugins/panel-drawer

# 更新插件：直接重装会报 ambiguous-install，必须先卸再装
# （plugin_manager: remove_bundle → install_bundle）
```

装完热更新即到已打开的页面，不用手动刷新。

## 默认收编

| 入口 | id | 槽位 | 稳定 selector |
|---|---|---|---|
| 技能中心 | `skill-explorer` | sidebar.panellist | —（标签实时解析） |
| 任务看板 | `task-board` | sidebar.panellist | —（标签实时解析） |
| 上下文洞察 | `context-overview` | sidebar.footer.action | `button.lc-ov-entry` |

## 已知限制

- 隐藏是**消费端手法**（CSS/DOM），上游没有官方隐藏 API；上游若改按钮标签，
  同步器会跟着重算，但完全无标签的内部条目无法收编
- 配置存 localStorage：换浏览器 / 清站点数据 = 回默认三件套
- 悬停只出壳自带 tooltip，弹层靠点击（要做 hover 弹层另说）
- 抽屉行的图标依赖 `ctx.slots.render`，宿主未暴露时降级为纯文字行
