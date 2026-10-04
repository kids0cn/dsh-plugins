# @local/dsh-monitor — DSH 右栏系统监视器

DeepSeek Harness (DSH) 的一个 bundle 插件：右侧边栏新增「系统监视器」标签，与文件、终端并列，实时展示系统占用、后台任务、长运行服务和 Docker 容器，支持点杀进程。

## 功能

| 区块 | 数据源 | 说明 |
|---|---|---|
| 系统占用 | `os.cpus()` 差分 + `/proc/meminfo` + `os.loadavg()` | CPU%（两次采样差分）、内存（优先 MemAvailable）、负载，3 张卡 |
| 后台任务 | `ctx.jobs.list()` 全会话去重 | DSH 自己的后台任务：状态/发起会话/启动时间/运行时长 |
| 服务（≥1 分钟） | `ps -eo uid,pid,etimes,comm,args` | 本用户长运行进程，按时长降序；剔除 shell/systemd 噪音；NAME 列从 args 推导（绕过 node 的 `MainThread` comm） |
| 监听端口 | `/proc/net/tcp{,6}` state=0A | 本用户监听端口 chips |
| Docker 容器 | `docker ps` | CLI 不可用时明确显示「docker 不可用」 |
| **终止按钮** | `POST /api/monitor.kill` | 两击确认（终止 → 确认?），发 SIGTERM；确认后整行变黄进入「终止中…」，15 秒未死恢复并提示可重试 |

## 架构

两半边，一个 bundle：

```
index.js  (Host)   GET  /api/monitor.snapshot  快照（1s 缓存）
                   POST /api/monitor.kill      杀进程（5 道护栏）
client.js (Client) sidebarRightTabs.register + sidebar.right.pane.tab 槽
                   → 右栏「系统监视器」tab，2s 轮询快照
```

- 走 `ctx.connection.fetch.register`，与 deliverables 同一道鉴权栅栏（未登录 curl 一律 401）
- 注册到右栏 tab 系统（`sidebarRightTabs` + `sidebar.right.pane.tab` 槽），**不是**左侧 `sidebar.panellist`/`main`（v1 曾那样，已弃）

### 杀进程的 5 道护栏（index.js `KILL_ROUTE`）

1. pid 必须是安全整数且 >1
2. 拒杀 harness 自身（`process.pid`）
3. 拒杀 harness 父链（防杀掉监管进程连带对话死亡）
4. uid 必须与当前用户相同
5. pid 必须仍在服务表内 + 客户端回显 args 须与服务端一致（防 pid 复用竞态）

全部通过才发 SIGTERM，成功后清快照缓存。

## 安装 / 卸载

```bash
# 安装（在 DSH 会话里让我执行，或用 plugin_manager）
plugin_manager install_bundle /absolute/path/to/dsh-monitor-bundle

# 卸载
plugin_manager remove_bundle @local/dsh-monitor
```

**装完必须重启 DSH**（侧边栏「重启 DSH」按钮），然后刷新浏览器。

## 迁移（换机器）

1. 拷贝本目录到新机器
2. `install_bundle <新路径>/dsh-monitor-bundle`
3. 重启 DSH + 刷新页面

profile 的 `package.json` 里记录的是 link 路径，迁移后路径变了需重新 install（见下面的坑）。

## 已知的坑（都踩过）

| 现象 | 原因 | 处理 |
|---|---|---|
| 重复 `install_bundle` 报 `ambiguous-install` | profile 里记录的源是 `link:` 形式，换路径形式会被 pnpm 判为不同来源 | 别重试；直接重启 DSH，或用 `set_bundle` off/on |
| 改了 `index.js` 不生效 | Host 半边是 ESM，Node 模块缓存不重 import；HMR 只监听 patch/config 不管 bundle 源码 | **重启 DSH** |
| 改了 `client.js` 不生效 | 浏览器缓存 + boot graph rev 未变 | 重启 DSH 后**刷新页面** |
| 端口→进程归属做不了 | yama=1：非子进程的 `/proc/*/fd` readlink 同 uid 也 Permission denied | 放弃归属，改成「服务表 + 端口条」两独立数据源 |
| vite 这类外部进程不在「后台任务」里 | 它不是 DSH 启动的（父链 → /init），`ctx.jobs` 原理上捞不到 | 服务表（ps 全量扫描）覆盖 |
| node 进程 comm 是 `MainThread` | node 改过线程名 | NAME 列从 args 路径推导（`.../.bin/vite` → `vite`） |
| 右栏内容超出看不到、无滚动条 | tab 容器 `overflow:hidden`，滚动是内容自己的责任 | 根元素 `height:100% + overflow-y:auto` |

## 文件

```
index.js          Host：快照路由 + 杀进程路由 + /proc 解析
client.js         Client：右栏 tab、轮询、表格、按钮、locale(zh/en)、CSS(全 token)
cordis.patch.yml  bundle patch（insert 一行）
package.json      manifest：dsh.bundle.patch + dsh.client
locale/en.json    Plugin Manager 卡片元数据
locale/zh.json    同上，中文
icon.svg          卡片图标
CHANGELOG-v2.md   版本变更记录（v1→v5）
```

样式约束：只用 `--dsw-alias-*` 主题 token，字面量颜色仅限图标；不 import 任何 Harness Client 包（`dsh.client.inject` 只做激活排序）。
