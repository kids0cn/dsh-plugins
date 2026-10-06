# 改动清单（动机 / 验证 / 上游）

> 每处改动三要素：**为什么改**、**怎么证明改对了**、**上游有没有对应 issue**。
> 日期均为 2026-10-04（同一天的完整复盘见本机 Hermes 共享记忆 `HARNESS.md`）。

## 1. `forks/dsh-web-restart` —— 重启按钮（改动最大）

上游：[`github:1123762794/dsh-web-restart`](https://github.com/1123762794/dsh-web-restart) main `5de8214`（MIT）
上游 issue：[#2 建议按运行环境分支重启命令](https://github.com/1123762794/dsh-web-restart/issues/2)

| # | 改了什么 | 为什么 | 怎么验证的 |
|---|---|---|---|
| 1 | `ctx.shell.start(spec)` → 删除对 `ctx.shell` 的依赖，改用 node 内建 | shell 服务的抽象 API **只有 `resolve` + `execute`**（`dsh-tool-cordis` api-catalog），`start` 不存在 → 每次点击 `TypeError`，命令从没跑过（journal 17:47:37 / 20:30:30 两条同款） | journal 出现 `[dsh-web-restart] restart via systemd-kill(...)`，不再有 TypeError |
| 2 | 重启命令三分支 `plan()`（纯函数、可离线测） | 上游是 Windows PowerShell + `D:\1\...`，WSL 上两个都不存在 | 离线四分支全对：`systemd-kill(Restart=on-failure)` / `detached-relaunch` / 注入 `Restart=no` → `detached-after-unit(no)` / win32 |
| 3 | **不碰任何子进程**（推翻第一版"先清 cloudflared"） | cloudflared/pocket 隧道与"重启 dsh"主逻辑无关，顺手杀它把公网通道打断了（实测 `dsh.hack4fun.asia` → 530）；孤儿连接器的收敛归 pocket 自己（上游 issue #11） | 隔离子进程实测：父死、子存活；重启后隧道由 pocket 自动恢复 |
| 4 | client 掉线自动恢复（v1→v5 五版） | 用户要"点了重启、掉线、什么都不动、自动恢复"。v1 挂组件 effect → 断线卸载即死；v2 只靠 sessionStorage → storage 被禁静默失效；v3 `down` 信标在服务器宕着时必然送不到 + 后台标签页限流等了 70s | **信标链**（`/dsh-watch` → host journal）：`client armed` → `client reload (pid-changed)` **6 秒**；12 场景离线测全过（回归 R1–R8 + 静默 S1–S4） |
| 5 | 静默刷新（A+C） | 用户拍板"要静默" | 后台直接刷；可见时冻帧铺屏 → load+0.9s 淡出、10s 硬兜底。验收口径：「**还是能看出来，就这样吧**」→ 接受残留，状态 done |
| 6 | `/dsh-health` 加 `version`/`branch`/`pid`；新增 `/dsh-watch` 信标 | 改动要能被 curl 诊断（HMR `root: []` 不看源码 → 装载与否一探便知） | `curl localhost:3081/dsh-health`；journal 可见 `client armed/reload` |

**通用教训（写给未来的自己）**：跨断线必须活着的状态，别挂在会随断线被卸载的树上；
发给"正宕着的服务"的信标必然丢失，它的缺失不是证据。

## 2. `patches/dsh-pocket-2.10.6` —— 两处外科补丁

上游：npm `dsh-pocket@2.10.6`。上游 issue：#11（隧道自动恢复）、#33（重启即作废旧 cookie）。

| # | 改了什么 | 为什么 | 验证 |
|---|---|---|---|
| 1 | `home: internals.home` → `home: internals.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')` | `apply(ctx, config, internals = {})` 运行时 internals 恒 `{}` → `home=undefined` → `autoStatePath=null` → **marker 写与读整条链是死码** → 重启后公网隧道永不自动恢复（530） | 重启后 journal 出现 `marker found, starting tunnel` + `public tunnel auto-restored`，公网 200 |
| 2 | `sessionKey: randomBytes(16)` → `loadOrCreateSessionKey()` 落盘 `$DSH_HOME/dsh-pocket/session.key`（600） | cookie = `sha256(PIN:sessionKey)`，进程级随机 → **每次重启旧 cookie 必失配 → 强制重输 PIN**；自动刷新也只会落到登录页。**用户拍板：便利优先**（削弱了 issue #33 的"重启即作废"安全属性；换 PIN 仍全失效） | 双进程取到同值、权限 600、坏文件自动重生成（三测过） |

> ⚠️ 这是**改别人的包**，与本机"分层不伸手"的纪律相悖 —— 两处均由用户明示授权。
> 上游建议另提 issue（未提）。

## 3. `files/hooks/tool-budget.sh` —— 调研预算闸 v3

挂载：`~/.claude/settings.json` → `PostToolUse(matcher=bash)`（DSH 经 `hooks-claude-code` 桥读取）。

- v1 总量计数 → v2 **只计重复**（首见免费）+ **落盘回血**（write/edit 清零）→ v3 **换皮也算重复**
- v3 动机：一次会话 51 条 bash **字面全唯一**、闸只记 6 次，却兜了 20 分钟 —— 同一条 grep 换关键词、
  同一个 heredoc 换正文，字面不同、事是同一件 → 归一化骨架（heredoc 正文/引号字面量/数字抹掉）再判重
- 分档 60/150/300/500，每档一次；改脚本**立即生效**（无需重启），改 settings.json 才要重启
- 验证：7 场景全过（换关键词 +1、换 heredoc 正文 +1、`cat "a.txt"`/`cat "b.txt"` 不算、60 次触发第 1 档、reset 回血）

## 4. `plugins/dsh-monitor`

侧边栏监视面板：Host 半边注册 `/api/monitor.snapshot`（jobs / session 标题 / CPU-内存-负载），
Client 半边进 `sidebar.panellist` + `main` 槽，2s 轮询。安装：`dsh plugin --profile web add <本目录>`。

## 5. `plugins/sidebar-auto-collapse`

侧边栏自动折叠 + 悬停展开（client 半边为主）。安装同上。

上游：`deepseek-ai/deepseek-harness`（该仓 **Issues 关闭**，走 Discussions）
上游 issue：[Discussions #8882 — ui-layout 缓动失效](https://github.com/deepseek-ai/deepseek-harness/discussions/8882)（2026-10-05 提）

| # | 改了什么 | 为什么 | 怎么验证的 |
|---|---|---|---|
| 1 | `newSnapshotStore` → `createSnapshotStore` | `apply` 首行 ReferenceError → fiber `failed`，页面报「1 entry did not activate」 | `list_plugins` `fiberPhase: active`，页面无红条 |
| 2 | 重跑 `install_bundle` 恢复 bundle 登记 | 22:28 一次 plugin-manager 操作重写 profile `package.json`，把本包从 `dsh.profile.bundles`/`dependencies` 抹掉 → 23:58 重启后**客户端启动图里没有本包**（71 条缺一） | `window.__DSH_BOOT__.entries` 含 `@local/sidebar-auto-collapse` |
| 3 | 命中判定 `insideColumn`（爬祖先）→ `pointerInside`（锚点横向范围 + 排除模态） | **frame 同时是左栏和中栏的祖先** → 中栏目标恒判"在栏内" → 移出永不收起 | 真机：移出 171ms 收起（改前不动）；单测加 frame 陷阱 fixture |
| 4 | 400ms 结算死区 → 目标态对账（`target`，`wide` 只做现实确认） | `wide` 收起方向滞后 150ms，反向最坏卡 ~560ms，手感一顿一顿 | 单测「过渡中途反向立即生效」3 项；真机悬停进 11–29ms |
| 5 | 锚点加 `data-asc` 诊断属性（`enabled/inside/wide/note`） | 排查时看不到控制器内部状态，只能靠猜 | 真机读 `data-asc` 直接定位到第 3 条那个 bug |

真机采样口径：agent-browser 纯 JS eval，每 15ms 读 `getComputedStyle(frame).gridTemplateColumns`，
对照组是**宿主自己的按钮**（同样一帧切 → 证明缓动是宿主问题，见上游 issue）。

## 6. `files/profile/` —— web profile 配置快照

- `cordis.patch.yml`：hooks 桥（`configPath: ~/.claude/settings.json`）、`llm-mimo` 端点与目录、
  默认模型 `mimo-v2.6-flash`、主题字号、本地 bundle 插入行
- `package.json`：本地 bundle 依赖（`link:` 指向本机路径 —— **换机要改路径**）

> 这两个是**本机配置**不是通用插件，`apply.sh` 默认不覆盖（`--with-profile` 才拷），
> 换机重建时对照着改。

## 7. `plugins/panel-drawer` —— 左侧栏二级抽屉（2026-10-06）

动机：面板类插件装多了左侧栏拥挤，而 skill-explorer / task-board / dsh-context **都没有官方
"隐藏入口"配置**。用户拍板方案 B：panellist 只留 1 个图标 + 弹层收纳，通用配置可拖动。

| # | 改了什么 / 踩了什么 | 为什么 | 怎么验证的 |
|---|---|---|---|
| 1 | 图标尺寸用槽位传入的 `props.size`（16/18），首版写 `100%` 撑成巨大卡片 | `panelGlyph` 不是定尺寸盒，百分比按整行宽度解析 | 首版被用户截图纠正（「你自己看看丑不丑」）→ 修后 eval 实测 glyph 16×16、行高 36 |
| 2 | 整行点击：document **捕获层**拦本行 click 再 toggle | 壳的 `PanelRow onClick=selectPanel`，点行内文字直接进了管理页（用户报「没有弹出二级抽屉」） | 探针复现用户点法（点文字）→ flyout 开、`aria-current=null`（selectPanel 未触发）、点空白关闭 |
| 3 | 隐藏 = 双语 aria-label CSS + DOM 同步兜底 + 条目级稳定 selector（`button.lc-ov-entry`） | 官方无隐藏 API；页面语言切 EN 后中文规则失配（实测 `Context Insights` 没藏住） | eval computed display：EN 页 Skill Center / Context Insights 均 `none`，Plugins 未误伤 |
| 4 | CATALOG 静态元数据（双语标签/selector）与用户配置分离 | 条目移出抽屉后配置里没有 selector → 管理页认不出、加不回来（自测撞出） | 放回→再收进按钮回路 + 重载恢复默认三件套 |
| 5 | 更新插件必须 `remove_bundle` → `install_bundle` | 直接重装报 `ambiguous-install`（link 源归一化判异源），连踩 3 轮 | 第 4 轮起走卸装循环，零 warning applied |

## 未做的事

- 上游 issue：`dsh-web-restart` #2 提过；pocket 的两处**未提 issue**；
  ui-layout 缓动失效已提 harness [Discussions #8882](https://github.com/deepseek-ai/deepseek-harness/discussions/8882)（该仓 Issues 关闭）
- 未做：把 `dsh-web-restart` 的改动回流上游 / 建 GitHub fork（用户拍板：只存快照靠重放）
