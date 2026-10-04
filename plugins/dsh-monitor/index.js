/** Host half of @local/dsh-monitor: one authenticated snapshot route feeding the sidebar monitor panel. */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

export const inject = ['connection', 'jobs', 'sessionQuery', 'sessions'];

const ROUTE = '/api/monitor.snapshot';
const KILL_ROUTE = '/api/monitor.kill';
const CACHE_MS = 1000;
const TITLE_TTL_MS = 60_000;
const CPU_MIN_GAP_MS = 400;
const MIN_SERVICE_SEC = 60;
const MAX_SERVICES = 20;
const MAX_COMMAND_CHARS = 200;
/** Interactive shells and session plumbing — not "services" a user starts. */
const NOISE_COMM = new Set(['zsh', 'bash', 'dash', 'sh', 'fish', '-zsh', '-bash', 'systemd', '(sd-pam)', 'sd-pam']);

/** Run a command with a hard timeout; resolve null on any failure (missing binary, timeout, non-zero). */
function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

export function apply(ctx) {
  /** @type {Map<string, { title: string | null, at: number }>} */
  const titleCache = new Map();
  let cache = null;
  let prevCpu = os.cpus();
  let prevCpuAt = Date.now();
  let lastCpuPercent = null;

  /** Session title for a job owner, cached with a one-minute revalidation window. */
  async function titleFor(ownerId) {
    const hit = titleCache.get(ownerId);
    const now = Date.now();
    if (hit && now - hit.at < TITLE_TTL_MS) return hit.title;
    let title = null;
    try {
      const snap = await ctx.sessionQuery.readTitle(ownerId);
      title = snap && typeof snap.title === 'string' && snap.title.length > 0 ? snap.title : null;
    } catch {
      title = null;
    }
    titleCache.set(ownerId, { title, at: now });
    return title;
  }

  /** Every job the registry holds across live sessions plus unowned jobs, deduplicated by id. */
  function collectJobs() {
    const byId = new Map();
    for (const job of ctx.jobs.list()) byId.set(job.id, job);
    for (const session of ctx.sessions.list()) {
      for (const job of ctx.jobs.list(session.id)) byId.set(job.id, job);
    }
    return [...byId.values()];
  }

  /** CPU delta since the previous build, memory from /proc/meminfo when available, load and uptimes. */
  function systemStats(now) {
    const cpus = os.cpus();
    const gap = now - prevCpuAt;
    if (gap >= CPU_MIN_GAP_MS && cpus.length > 0 && cpus.length === prevCpu.length) {
      let total = 0;
      let idle = 0;
      for (let i = 0; i < cpus.length; i++) {
        const a = prevCpu[i].times;
        const b = cpus[i].times;
        const dTotal = b.user - a.user + (b.nice - a.nice) + (b.sys - a.sys) + (b.idle - a.idle) + (b.irq - a.irq);
        const dIdle = b.idle - a.idle;
        if (dTotal > 0) {
          total += dTotal;
          idle += dIdle;
        }
      }
      if (total > 0) lastCpuPercent = Math.round(((total - idle) / total) * 1000) / 10;
    }
    prevCpu = cpus;
    prevCpuAt = now;

    let memTotal = os.totalmem();
    let memAvailable = os.freemem();
    try {
      // /proc/meminfo's MemAvailable counts reclaimable cache; freemem alone overstates usage.
      const meminfo = readMeminfo();
      if (meminfo) {
        memTotal = meminfo.total;
        memAvailable = meminfo.available;
      }
    } catch {
      /* keep the os-module fallback */
    }
    return {
      cpuPercent: lastCpuPercent,
      cores: cpus.length,
      loadavg: os.loadavg().map((v) => Math.round(v * 100) / 100),
      memTotal,
      memUsed: Math.max(0, memTotal - memAvailable),
    };
  }

  /** User-owned listening TCP ports (v4+v6 merged). pid attribution needs privileges this box lacks (yama=1: fd links of non-descendants are unreadable even same-uid). */
  function listeningPorts() {
    const ports = new Set();
    for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n').slice(1)) {
        const f = line.trim().split(/\s+/);
        if (f.length < 8 || f[3] !== '0A') continue; // state 0A = LISTEN
        if (Number(f[7]) !== process.getuid()) continue; // uid field
        const colon = f[1].lastIndexOf(':');
        if (colon < 0) continue;
        const port = Number.parseInt(f[1].slice(colon + 1), 16);
        if (Number.isFinite(port) && port > 0) ports.add(port);
      }
    }
    return [...ports].sort((a, b) => a - b);
  }

  /**
   * Long-running processes of this user: the honest replacement for a top-CPU
   * list, which buried user-launched dev servers. Shells and session plumbing
   * are filtered; etime comes from ps so no /proc/stat clock math is needed.
   */
  async function serviceProcesses() {
    const out = await run('ps', ['-eo', 'uid=,pid=,etimes=,comm=,args='], 2000);
    if (out === null) return [];
    const uid = process.getuid();
    const rows = [];
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) continue;
      if (Number(m[1]) !== uid) continue;
      const etimes = Number(m[3]);
      if (etimes < MIN_SERVICE_SEC) continue;
      if (NOISE_COMM.has(m[4])) continue;
      rows.push({ pid: Number(m[2]), etimes, comm: m[4], name: displayName(m[4], m[5]), args: m[5].slice(0, MAX_COMMAND_CHARS) });
    }
    rows.sort((a, b) => b.etimes - a.etimes);
    return rows.slice(0, MAX_SERVICES);
  }

  /**
   * A short service name: comm when it identifies the binary (npm, esbuild,
   * cloudflared), otherwise the script path — node renamed its main thread to
   * "MainThread" for the vite process, so args is the only honest source there
   * (`node .../node_modules/.bin/vite --host` → "vite").
   */
  function displayName(comm, args) {
    const generic = new Set(['node', 'nodejs', 'mainthread', 'main', 'unknown', '']);
    if (!generic.has(String(comm).toLowerCase())) return comm;
    const tokens = String(args).split(/\s+/).filter(Boolean);
    for (const token of tokens.slice(1)) {
      if (token.startsWith('-') || !token.includes('/')) continue;
      const base = token.split('/').pop();
      if (base) return base.replace(/\.(c|m)?js$/, '');
    }
    const first = tokens[0] ? tokens[0].split('/').pop() : comm;
    return first || comm;
  }

  /** Docker containers when the CLI answers; null marks "docker unavailable" for the panel. */
  async function containers() {
    const out = await run('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}'], 1500);
    if (out === null) return null;
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = '', status = '', image = ''] = line.split('\t');
        return { name, status, image };
      });
  }

  async function buildSnapshot(now) {
    const jobs = collectJobs();
    const ownerIds = [...new Set(jobs.map((job) => (typeof job.owner === 'string' ? job.owner : job.owner && job.owner.id)).filter((id) => typeof id === 'string' && id.length > 0))];
    const titlePairs = await Promise.all(ownerIds.map(async (id) => [id, await titleFor(id)]));
    const titles = new Map(titlePairs);
    const [system, services, ports, docker] = [systemStats(now), await serviceProcesses(), listeningPorts(), await containers()];
    const serialized = jobs.map((job) => {
      const owner = typeof job.owner === 'string' ? job.owner : job.owner && job.owner.id ? job.owner.id : null;
      return {
        id: String(job.id),
        kind: String(job.kind),
        label: String(job.label ?? ''),
        status: String(job.status),
        progress: job.progress ? String(job.progress) : null,
        detail: job.detail ? String(job.detail) : null,
        owner,
        ownerTitle: owner ? titles.get(owner) ?? null : null,
        startedAt: Number(job.startedAt) || 0,
        finishedAt: job.finishedAt ? Number(job.finishedAt) : null,
      };
    });
    serialized.sort((left, right) => {
      const liveLeft = left.status === 'running' || left.status === 'stopping' ? 0 : 1;
      const liveRight = right.status === 'running' || right.status === 'stopping' ? 0 : 1;
      if (liveLeft !== liveRight) return liveLeft - liveRight;
      return right.startedAt - left.startedAt;
    });
    return { at: now, system, jobs: serialized, services, ports, containers: docker };
  }

  const dispose = ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        const now = Date.now();
        if (cache && now - cache.at < CACHE_MS) {
          return Response.json(cache.payload, { headers: { 'cache-control': 'no-store' } });
        }
        const payload = await buildSnapshot(now);
        cache = { at: now, payload };
        return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        return Response.json({ error: String((error && error.message) || error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    },
  });
  ctx.effect(() => () => {
    void dispose();
  }, 'dsh-monitor: snapshot route');

  /**
   * SIGTERM one process on the authenticated UI's behalf. Guarded in depth:
   * pid sanity, never the harness itself, never anything on the harness's
   * parent chain (killing the supervisor takes the conversation down too),
   * same uid, must currently sit in the service list the UI renders, and the
   * caller must echo back the args it displayed — closing the pid-reuse race
   * between render and click. A successful kill drops the snapshot cache so
   * the next poll reflects the death immediately.
   */
  const disposeKill = ctx.connection.fetch.register({
    path: KILL_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body;
      try {
        body = await request.json();
      } catch {
        return Response.json({ error: 'body is not JSON' }, { status: 400 });
      }
      const pid = body && body.pid;
      const sentArgs = body && typeof body.args === 'string' ? body.args : null;
      if (!Number.isSafeInteger(pid) || pid <= 1) {
        return Response.json({ error: `invalid pid: ${JSON.stringify(pid)}` }, { status: 400 });
      }
      if (pid === process.pid) {
        return Response.json({ error: 'refusing to terminate the harness itself' }, { status: 403 });
      }
      if (isAncestorOf(pid, process.pid)) {
        return Response.json({ error: `refusing to terminate pid ${pid}: it supervises the harness` }, { status: 403 });
      }
      const owner = procUid(pid);
      if (owner === null) {
        return Response.json({ error: `no such process: ${pid}` }, { status: 404 });
      }
      if (owner !== process.getuid()) {
        return Response.json({ error: `process ${pid} belongs to uid ${owner}` }, { status: 403 });
      }
      const row = (await serviceProcesses()).find((candidate) => candidate.pid === pid);
      if (row === undefined) {
        return Response.json({ error: `pid ${pid} is not in the service list` }, { status: 409 });
      }
      if (sentArgs !== null && sentArgs !== row.args) {
        return Response.json({ error: 'process command changed since render; refresh and retry' }, { status: 409 });
      }
      try {
        process.kill(pid, 'SIGTERM');
      } catch (cause) {
        const code = cause && cause.code;
        const message = code === 'ESRCH' ? `no such process: ${pid}` : code === 'EPERM' ? `permission denied: ${pid}` : String((cause && cause.message) || cause);
        return Response.json({ error: message }, { status: code === 'ESRCH' ? 404 : 403 });
      }
      cache = null;
      return Response.json({ ok: true });
    },
  });
  ctx.effect(() => () => {
    void disposeKill();
  }, 'dsh-monitor: kill route');
}

/** Effective uid of a pid from /proc, or null when it is gone or unreadable. */
function procUid(pid) {
  try {
    const match = /^Uid:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** Parent pid from /proc/<pid>/stat field 4 (parsed past a comm that may contain spaces), or null. */
function procPpid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(rest[1]);
    return Number.isSafeInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}

/** Whether `pid` sits on the parent chain of `ofPid` (walks stop at pid 1, which is never a target here). */
function isAncestorOf(pid, ofPid) {
  let cursor = ofPid;
  for (let hops = 0; hops < 64 && cursor > 1; hops++) {
    if (cursor === pid) return true;
    const next = procPpid(cursor);
    if (next === null) return false;
    cursor = next;
  }
  return false;
}

/** Parse MemTotal and MemAvailable from /proc/meminfo; null when the file is absent (non-Linux). */
function readMeminfo() {
  if (!fs.existsSync('/proc/meminfo')) return null;
  const text = fs.readFileSync('/proc/meminfo', 'utf8');
  const total = /MemTotal:\s+(\d+) kB/.exec(text);
  const available = /MemAvailable:\s+(\d+) kB/.exec(text);
  if (!total) return null;
  return { total: Number(total[1]) * 1024, available: available ? Number(available[1]) * 1024 : os.freemem() };
}
