# dsh-monitor 变更记录

## v3（2026-10-04，本轮）
用户反馈：①不要 CPU 进程表；②本机运行时间卡片去掉；③自己后台起的 vite 要能看到。

### 定位结论（实测）
- vite = pid 1071，外部启动（父链 → /init），监听 5173，**不是 DSH 后台任务**，jobs 列表永远捞不到
- 端口→pid 归属不可行：yama=1，非子进程的 /proc/*/fd readlink 同 uid 也 Permission denied（dsh host 同样读不了）
- 所以改为两个独立数据源：
  - **服务表** = `ps -eo uid,pid,etimes,comm,args` 过滤 `uid==self && etimes>=60 && comm 非 shell/systemd`，按时长降序取 20 → 实测 8 行，vite(1071)/esbuild/dinotty/hermes/cloudflared 全部命中
  - **监听端口条** = /proc/net/tcp{,6} 中 `state=0A && uid==self` 的端口去重 → 实测 3081 3082 5173 8999 20242（5173 在内）

### 改动
- index.js：删 processList(top-CPU)、删 hostUptimeSec/nodeUptimeSec；增 listeningPorts()、serviceProcesses()
- client.js：删进程表(5列)和 uptime 卡；增「服务（运行≥1分钟）」表（PID/TIME/CMD，3列）+ 监听端口 chips；locale zh/en 同步

### 部署
- Host ESM 改动需**重启 DSH** 才生效（Node 模块缓存；toggle bundle 不重 import）
- 重复 install_bundle 报 ambiguous-install（link: 源判别），勿重试，直接重启
- 重启后浏览器刷新

## v2（同日早些时候）
- 形态：左侧主面板 → 右侧标签栏（sidebarRightTabs + sidebar.right.pane.tab，与文件/终端并列）
- 修崩溃：containers 三态（undefined 未加载 / null docker 不可用 / [] 空）
- 右栏窄版布局：进程表 6→5 列、卡片 200→150px

## v1（同日）
- 初版：sidebar.panellist 图标 + main 主面板 + /api/monitor.snapshot 快照路由（1s 缓存）

## v4（同日）：NAME 列 + 终止按钮
- 服务表加 NAME 列：comm 无意义时（node→MainThread）从 args 路径推导（vite 可见）
- 每行「终止」按钮：两击确认（终止 → 确认?，3s 自动复位），POST /api/monitor.kill 发 SIGTERM
- Host 5 道护栏：pid 合法 / 拒杀自身 / 拒杀父链 / 同 uid / 服务表内 + args 回显防 pid 复用竞态
- 成功后清快照缓存即时刷新；locale zh/en 同步

## v5（同日）：滚动 + 处理中反馈
- 右栏 tab 容器 overflow:hidden，页面根元素自设 height:100% + overflow-y:auto（修「超出看不到」）
- 确认杀进程后整行变黄（warn-tertiary 底 + warn 名字）+ 按钮禁用显示「终止中…」
- 15s 未退出 → 恢复按钮 + 提示「TERM 可能被忽略，可再次终止」；进程消失自动清理 pending
