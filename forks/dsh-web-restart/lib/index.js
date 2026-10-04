/**
 * dsh-web-restart — host half.（2026-10-04 WSL 重写）
 *
 * 上游（github:1123762794/dsh-web-restart，main 5de8214）两个问题：
 *  ① `ctx.shell.start(spec)` —— shell 服务的抽象 API 只有 `resolve` + `execute`
 *     （dsh-tool-cordis api-catalog 的 shell 条目；dsh-bash-sandbox 同样只实现这两个），
 *     `start` 不存在 → 每次点击 TypeError，命令根本没跑
 *     （journal 实测 17:47:37 与 20:30:30 两条同款报错）。
 *  ② 重启命令是 Windows 专用 PowerShell + 硬编码 `D:\1\dsh-web-host.ps1`，
 *     WSL 上既没那个脚本也解析不到 powershell → 就算 ① 修好也拉不起来。
 *
 * 本机（WSL2 + systemd）实测事实，重写据此分支：
 *  - dsh-web 由系统单元托管：`/etc/systemd/system/dsh-web.service`
 *    （User=developer、Restart=on-failure、RestartSec=3），进程环境带 INVOCATION_ID、
 *    cgroup 是 `/system.slice/dsh-web.service` → **自杀即可，3 秒后 systemd 自动拉起**；
 *    全程不需要 sudo（本机 `sudo systemctl restart` 要密码，按钮走不通）。
 *  - **不碰任何子进程**（2026-10-04 用户定的）：cloudflared / pocket 隧道是辅助服务，
 *    与"重启 dsh"主逻辑无关。第一版"顺手清直接子进程"把访问 GUI 的公网通道一起
 *    打断了（实测重启后 dsh.hack4fun.asia → 530，且 marker 缺失 pocket 未自动恢复），
 *    属于跨插件伸手。孤儿连接器的收敛与自动恢复归 pocket 自己
 *    （issue #11：dispose 时停隧道留 marker，启动时 restoreTunnelIfNeeded 拉起）。
 *    残留风险：隧道开着且 marker 存在时，重启会多出一个连接器 —— 那是 pocket 的层。
 *  - 单元 `Restart=no / on-success`（SIGKILL 不会触发重启）→ 退回"派生再自杀"。
 *  - 手动 `dsh web` 起的（无 INVOCATION_ID）：先派生脱离终端的同命令行
 *    （内部 sleep 2 等父进程让出端口），再自杀。
 *
 * 不再依赖 ctx.shell（bundle 是普通 ESM，直接用 node 内建）。
 * plan() 是纯函数并单独导出 → 可离线验证分支选择，不触发真实重启。
 * /dsh-health 返回 version + branch → curl 即可确认新代码是否已装载。
 */
import fs from 'node:fs'
import { spawn } from 'node:child_process'

export const name = 'dsh-web-restart'
export const inject = ['webServer']

/** 装载标记：/dsh-health 能看到它 = 新代码已在跑。wsl-4 = 加 /dsh-watch 信标（前端看门狗可诊断）。 */
export const VERSION = 'wsl-4'

/** 上游原样的 Windows 目标脚本（本机是 WSL，win32 支持仅保留、不可测）。 */
const WIN_PS_SCRIPT = 'Start-Sleep -Seconds 3; & "D:\\1\\dsh-web-host.ps1"'

/** 手动拉起时的输出落点（脱离终端后 journal 里没有它）。 */
const RELAUNCH_LOG = '/tmp/dsh-web-restart-relaunch.log'

const UNIT_DIRS = ['/etc/systemd/system', '/run/systemd/system', '/usr/lib/systemd/system']

/** shell-quote one argument for the sh -c relaunch. */
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** 从 /proc/<pid>/cgroup 取单元名（`0::/system.slice/dsh-web.service` → `dsh-web.service`）。 */
export function unitName(pid) {
  try {
    const line = fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8')
      .split('\n').find((l) => l.includes('.service'))
    if (!line) return ''
    return line.slice(line.lastIndexOf('/') + 1).trim()
  } catch {
    return ''
  }
}

/** 读单元文件的 Restart= 值；查不到按 on-failure（本机实测值）。dirs 可注入用于测试。 */
export function unitRestart(unit, dirs = UNIT_DIRS) {
  if (!unit) return 'on-failure'
  for (const dir of dirs) {
    try {
      const text = fs.readFileSync(`${dir}/${unit}`, 'utf8')
      const m = text.match(/^\s*Restart\s*=\s*(\S+)/m)
      if (m) return m[1]
    } catch {
      /* 没有这个文件就看下一个目录 */
    }
  }
  return 'on-failure'
}

/**
 * 纯函数：按运行时选一支重启动作。不发信号、不派生进程，可离线调用。
 * @returns {{branch: string, mode: 'kill'|'spawn'|'win', script?: string, args?: string[], message: string}}
 */
export function plan(env = process.env, platform = process.platform, pid = process.pid, dirs = UNIT_DIRS) {
  if (platform === 'win32') {
    return {
      branch: 'windows-powershell',
      mode: 'win',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PS_SCRIPT],
      message: '重启已触发：DSH 将断开约 15-20 秒，之后请刷新页面'
    }
  }
  const systemdManaged = Boolean(env.INVOCATION_ID)
  const restart = systemdManaged ? unitRestart(unitName(pid), dirs) : 'none'
  if (systemdManaged && restart !== 'no' && restart !== 'on-success') {
    return {
      branch: `systemd-kill(Restart=${restart})`,
      mode: 'kill',
      message: '重启已触发：DSH 将断开数秒，systemd 数秒后自动拉起，状态灯变绿后刷新页面'
    }
  }
  const argv = [process.execPath, ...process.argv.slice(1)].map(shQuote).join(' ')
  return {
    branch: systemdManaged ? `detached-after-unit(${restart})` : 'detached-relaunch',
    mode: 'spawn',
    script: `sleep 2; cd ${shQuote(process.cwd())} && exec ${argv}`,
    message: '重启已触发：DSH 将断开数秒（脱离终端自动拉起），状态灯变绿后刷新页面'
  }
}

/**
 * 执行 plan()：（非 kill 支先派生替代者）→ 200ms 后 SIGKILL 自己。
 * 只对本进程动手，**不碰任何子进程**（见文件头「不碰任何子进程」的裁定）。
 * 导出仅作离线测试缝（在隔离子进程里调，别在本进程调）。
 */
export function run(p, platform) {
  const posix = platform !== 'win32'
  if (p.mode !== 'kill') {
    let out = 'ignore'
    try {
      out = fs.openSync(RELAUNCH_LOG, 'a')
    } catch {
      out = 'ignore'
    }
    const child = p.mode === 'win'
      ? spawn('powershell.exe', p.args, { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn('sh', ['-c', p.script], { detached: true, stdio: ['ignore', out, out] })
    child.unref()
    if (out !== 'ignore') fs.closeSync(out)
  }
  if (posix) setTimeout(() => process.kill(process.pid, 'SIGKILL'), 200)
}

export function apply(ctx) {
  let restarting = false
  const current = plan() // 与 apply 同进程同环境，算一次即可

  const disposeHealth = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-health',
    handler: async (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, ts: Date.now(), pid: process.pid, version: VERSION, branch: current.branch }))
    }
  })

  // 浏览器端看门狗的单向信标（v3）：把「armed / down / reload」打进 journal，
  // 让"前端到底有没有在盯、有没有下令刷新"可被 curl/journal 诊断，不再盲猜。
  const disposeWatch = ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-watch',
    handler: async (req, res) => {
      try {
        const u = new URL(req.url, 'http://local')
        const ev = u.searchParams.get('e') || '?'
        const reason = u.searchParams.get('reason') || ''
        console.log(`[dsh-web-restart] client ${ev}${reason ? ` (${reason})` : ''}`)
      } catch { /* 信标坏了也不影响响应 */ }
      res.writeHead(204, { 'cache-control': 'no-store' })
      res.end()
    }
  })

  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: '/restart-dsh',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: 'method not allowed' }))
        return
      }
      if (restarting) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: false, message: '重启已在进行中，请稍候' }))
        return
      }
      restarting = true
      // 注意：webServer handler 是纯 Node http 回调，不在 Cordis fiber 上下文里，
      // ctx.timeout（mixin→ctx.effect）在此不触发；用 Node 原生 setTimeout。
      setTimeout(() => {
        try {
          // 先响应、1 秒后才动手 → 前端有时间渲染"重启中"；动手后进程自杀，响应早已送达。
          // 分支带进 journal：原版静默失败正是 WSL 上"按钮看起来好了"的根因。
          console.log(`[dsh-web-restart] restart via ${current.branch}`)
          run(current, process.platform)
        } catch (error) {
          restarting = false
          console.error('[dsh-web-restart] failed to launch restart:', error)
        }
      }, 1000)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, message: current.message }))
    }
  })

  return () => { disposeHealth(); disposeWatch(); disposeRoute() }
}
