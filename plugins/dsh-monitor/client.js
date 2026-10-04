/** Client half of @local/dsh-monitor: sidebar panel icon + central monitor page polling the Host snapshot route. */
window.__ModuleLoader__.load({
  id: '@local/dsh-monitor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'monitor';
    const TAB_ID = '@local/dsh-monitor';
    const TAB_KIND = 'monitor';
    const POLL_MS = 2000;
    const SNAPSHOT_ROUTE = 'api/monitor.snapshot';
    const KILL_ROUTE = 'api/monitor.kill';
    const ARM_DISARM_MS = 3000;
    const NOTICE_MS = 4000;
    const KILL_WAIT_MS = 15000;

    const zh = {
      'panel': '监视器',
      'title': '系统监视器',
      'subtitle': '后台任务 · 系统占用 · 服务',
      'refresh': '每 2 秒自动刷新',
      'updatedAt': '更新于 {time}',
      'section.system': '系统占用',
      'section.jobs': '后台任务',
      'section.services': '服务（运行 ≥1 分钟）',
      'section.containers': 'Docker 容器',
      'stat.cpu': 'CPU',
      'stat.mem': '内存',
      'stat.load': '负载',
      'stat.cores': '{n} 核',
      'jobs.empty': '当前没有后台任务',
      'jobs.owner': '发起：{who}',
      'jobs.ownerAnonymous': '发起：系统',
      'jobs.started': '开始于 {time}',
      'jobs.elapsed': '已运行 {dur}',
      'jobs.done': '共运行 {dur}',
      'status.running': '运行中',
      'status.stopping': '停止中',
      'status.completed': '已完成',
      'status.killed': '已停止',
      'status.failed': '失败',
      'services.empty': '没有长时间运行的服务',
      'services.ports': '监听端口',
      'services.noPorts': '无监听端口',
      'kill.action': '终止',
      'kill.confirm': '确认?',
      'kill.failed': '终止失败：{msg}',
      'kill.done': '已发送 TERM，等待退出…',
      'kill.pending': '终止中…',
      'kill.stillAlive': '{name} 仍未退出，TERM 可能被忽略，可再次终止',
      'containers.unavailable': 'docker 不可用',
      'containers.empty': '没有运行中的容器',
      'error': '读取失败：{msg}',
      'kind.bash': '命令',
      'kind.subagent': '子代理',
    };

    const en = {
      'panel': 'Monitor',
      'title': 'System Monitor',
      'subtitle': 'Background jobs · Usage · Services',
      'refresh': 'Refreshes every 2s',
      'updatedAt': 'Updated {time}',
      'section.system': 'Usage',
      'section.jobs': 'Background Jobs',
      'section.services': 'Services (running ≥1 min)',
      'section.containers': 'Docker Containers',
      'stat.cpu': 'CPU',
      'stat.mem': 'Memory',
      'stat.load': 'Load',
      'stat.cores': '{n} cores',
      'jobs.empty': 'No background jobs',
      'jobs.owner': 'By: {who}',
      'jobs.ownerAnonymous': 'By: system',
      'jobs.started': 'Started {time}',
      'jobs.elapsed': 'Running {dur}',
      'jobs.done': 'Ran {dur}',
      'status.running': 'Running',
      'status.stopping': 'Stopping',
      'status.completed': 'Completed',
      'status.killed': 'Killed',
      'status.failed': 'Failed',
      'services.empty': 'No long-running services',
      'services.ports': 'Listening ports',
      'services.noPorts': 'No listening ports',
      'kill.action': 'Kill',
      'kill.confirm': 'Sure?',
      'kill.failed': 'Kill failed: {msg}',
      'kill.done': 'TERM sent, waiting…',
      'kill.pending': 'wait…',
      'kill.stillAlive': '{name} is still running — TERM may be ignored; you can kill again',
      'containers.unavailable': 'docker unavailable',
      'containers.empty': 'No running containers',
      'error': 'Failed to load: {msg}',
      'kind.bash': 'shell',
      'kind.subagent': 'subagent',
    };

    /** Simple `{name}` interpolation over the bound translate function. */
    function fill(t, key, params) {
      const raw = t(key);
      if (!params) return raw;
      return raw.replace(/\{(\w+)\}/g, (whole, name) => (name in params ? String(params[name]) : whole));
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
      const value = bytes / Math.pow(1024, index);
      return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
    }

    function formatDuration(ms, t) {
      if (!Number.isFinite(ms) || ms < 0) ms = 0;
      const totalSec = Math.floor(ms / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      if (days > 0) return `${days}d ${hours}h`;
      if (hours > 0) return `${hours}h ${minutes}m`;
      if (minutes > 0) return `${minutes}m ${seconds}s`;
      return `${seconds}s`;
    }

    function formatClock(epochMs) {
      if (!Number.isFinite(epochMs) || epochMs <= 0) return '--:--:--';
      return new Date(epochMs).toLocaleTimeString();
    }

    const STATUS_TOKEN = {
      running: 'var(--dsw-alias-state-success-primary)',
      stopping: 'var(--dsw-alias-state-warn-primary)',
      completed: 'var(--dsw-alias-label-secondary)',
      killed: 'var(--dsw-alias-state-warn-primary)',
      failed: 'var(--dsw-alias-state-error-primary)',
    };

    function SystemStats({ system, t }) {
      if (!system) return null;
      const cpu = system.cpuPercent;
      const cpuLabel = cpu === null || cpu === undefined ? '--' : `${cpu}%`;
      const memPct = system.memTotal > 0 ? Math.round((system.memUsed / system.memTotal) * 100) : 0;
      const cards = [
        { key: 'cpu', label: t('stat.cpu'), value: cpuLabel, extra: fill(t, 'stat.cores', { n: system.cores }), ratio: cpu === null ? null : Math.min(1, cpu / 100) },
        { key: 'mem', label: t('stat.mem'), value: `${memPct}%`, extra: `${formatBytes(system.memUsed)} / ${formatBytes(system.memTotal)}`, ratio: Math.min(1, memPct / 100) },
        { key: 'load', label: t('stat.load'), value: (system.loadavg || []).join(' · '), extra: null, ratio: null },
      ];
      return h(
        'div',
        { className: 'dshm-grid' },
        cards.map((card) =>
          h(
            'div',
            { key: card.key, className: 'dshm-card' },
            h('div', { className: 'dshm-card-label' }, card.label),
            h('div', { className: 'dshm-card-value' }, card.value),
            card.ratio === null
              ? card.extra
                ? h('div', { className: 'dshm-card-extra' }, card.extra)
                : null
              : h(
                  'div',
                  { className: 'dshm-bar', role: 'presentation' },
                  h('div', { className: 'dshm-bar-fill', style: { width: `${Math.round(card.ratio * 100)}%` } })
                ),
            card.ratio !== null && card.extra
              ? h('div', { className: 'dshm-card-extra' }, card.extra)
              : null
          )
        )
      );
    }

    function JobRow({ job, now, t }) {
      const color = STATUS_TOKEN[job.status] || 'var(--dsw-alias-state-idle-primary)';
      const statusText = t(`status.${job.status}`);
      const who = job.ownerTitle || (job.owner ? job.owner.slice(0, 8) : null);
      const durationMs = (job.finishedAt || now) - job.startedAt;
      const live = job.status === 'running' || job.status === 'stopping';
      const kindLabel = t(`kind.${job.kind}`);
      return h(
        'div',
        { className: 'dshm-job' },
        h('span', { className: 'dshm-dot', style: { background: color }, title: statusText }),
        h(
          'div',
          { className: 'dshm-job-body' },
          h(
            'div',
            { className: 'dshm-job-line' },
            h('span', { className: 'dshm-job-label', title: job.label }, job.label || job.id),
            h('span', { className: 'dshm-chip' }, job.id),
            h('span', { className: 'dshm-chip' }, kindLabel),
            job.progress ? h('span', { className: 'dshm-chip dshm-chip-accent' }, job.progress) : null
          ),
          h(
            'div',
            { className: 'dshm-job-meta' },
            h('span', { style: { color } }, statusText),
            h('span', null, who ? fill(t, 'jobs.owner', { who }) : t('jobs.ownerAnonymous')),
            h('span', null, fill(t, 'jobs.started', { time: formatClock(job.startedAt) })),
            h('span', null, fill(t, live ? 'jobs.elapsed' : 'jobs.done', { dur: formatDuration(durationMs, t) })),
            job.detail ? h('span', { className: 'dshm-job-detail' }, job.detail) : null
          )
        )
      );
    }

    function MonitorPage(props) {
      const t = props.t;
      const [snapshot, setSnapshot] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [armed, setArmed] = React.useState(null);
      const [notice, setNotice] = React.useState(null);
      const [pending, setPending] = React.useState({});
      const loadRef = React.useRef(null);
      const armTimerRef = React.useRef(null);
      const noticeTimerRef = React.useRef(null);
      const pendingTimersRef = React.useRef({});
      const snapshotRef = React.useRef(null);

      React.useEffect(() => {
        let alive = true;
        const load = async () => {
          try {
            const response = await fetch(SNAPSHOT_ROUTE, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!alive) return;
            if (typeof data.error === 'string') setError(data.error);
            else {
              setSnapshot(data);
              snapshotRef.current = data;
              setError(null);
            }
          } catch (cause) {
            if (alive) setError(String((cause && cause.message) || cause));
          }
        };
        load();
        loadRef.current = load;
        const timer = setInterval(load, POLL_MS);
        return () => {
          alive = false;
          clearInterval(timer);
          loadRef.current = null;
          if (armTimerRef.current) clearTimeout(armTimerRef.current);
          if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
          for (const timer of Object.values(pendingTimersRef.current)) clearTimeout(timer);
          pendingTimersRef.current = {};
        };
      }, []);

      const showNotice = (kind, text) => {
        setNotice({ kind, text });
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
      };

      /**
       * Two-click to fire: first click arms the row (auto-disarms), second click
       * POSTs SIGTERM. On success the row enters `pending` — tinted, button
       * disabled showing "wait…" — until the process actually leaves the
       * snapshot, so a slow TERM reads as "processing" instead of "ignored".
       * If it is still alive after KILL_WAIT_MS, pending lifts and a notice
       * invites a retry (the harness refuses nothing; SIGTERM may just be ignored).
       */
      const killProcess = async (svc) => {
        if (armed !== svc.pid) {
          setArmed(svc.pid);
          if (armTimerRef.current) clearTimeout(armTimerRef.current);
          armTimerRef.current = setTimeout(() => setArmed(null), ARM_DISARM_MS);
          return;
        }
        if (armTimerRef.current) clearTimeout(armTimerRef.current);
        setArmed(null);
        try {
          const response = await fetch(KILL_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pid: svc.pid, args: svc.args }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            showNotice('error', fill(t, 'kill.failed', { msg: data.error || `HTTP ${response.status}` }));
            return;
          }
          showNotice('ok', t('kill.done'));
          setPending((prev) => ({ ...prev, [svc.pid]: true }));
          if (pendingTimersRef.current[svc.pid]) clearTimeout(pendingTimersRef.current[svc.pid]);
          pendingTimersRef.current[svc.pid] = setTimeout(() => {
            delete pendingTimersRef.current[svc.pid];
            setPending((prev) => {
              if (!prev[svc.pid]) return prev;
              const next = { ...prev };
              delete next[svc.pid];
              return next;
            });
            const stillThere = (snapshotRef.current && snapshotRef.current.services || []).some((row) => row.pid === svc.pid);
            if (stillThere) showNotice('error', fill(t, 'kill.stillAlive', { name: svc.name || svc.comm }));
          }, KILL_WAIT_MS);
          if (loadRef.current) loadRef.current();
        } catch (cause) {
          showNotice('error', fill(t, 'kill.failed', { msg: String((cause && cause.message) || cause) }));
        }
      };

      /** A pending flag for a row the snapshot no longer lists is stale — drop it and its timer. */
      React.useEffect(() => {
        if (!snapshot) return;
        const live = new Set(snapshot.services.map((svc) => svc.pid));
        setPending((prev) => {
          const stale = Object.keys(prev).filter((pid) => !live.has(Number(pid)));
          if (stale.length === 0) return prev;
          for (const pid of stale) {
            if (pendingTimersRef.current[pid]) {
              clearTimeout(pendingTimersRef.current[pid]);
              delete pendingTimersRef.current[pid];
            }
          }
          const next = { ...prev };
          for (const pid of stale) delete next[pid];
          return next;
        });
      }, [snapshot]);

      const now = Date.now();
      const system = snapshot && snapshot.system;
      const jobs = (snapshot && snapshot.jobs) || [];
      const services = (snapshot && snapshot.services) || [];
      const ports = (snapshot && snapshot.ports) || [];
      const containers = snapshot ? snapshot.containers : undefined;

      return h(
        'div',
        { className: 'dshm-page' },
        h(
          'header',
          { className: 'dshm-header' },
          h('div', null,
            h('h1', { className: 'dshm-title' }, t('title')),
            h('div', { className: 'dshm-subtitle' }, t('subtitle'))
          ),
          h('div', { className: 'dshm-updated' },
            snapshot ? fill(t, 'updatedAt', { time: formatClock(snapshot.at) }) : t('refresh'),
            error ? h('span', { className: 'dshm-error' }, fill(t, 'error', { msg: error })) : null
          )
        ),
        h('section', { className: 'dshm-section' },
          h('h2', { className: 'dshm-section-title' }, t('section.system')),
          h(SystemStats, { system, t })
        ),
        h('section', { className: 'dshm-section' },
          h('h2', { className: 'dshm-section-title' }, t('section.jobs')),
          jobs.length === 0
            ? h('div', { className: 'dshm-empty' }, t('jobs.empty'))
            : h('div', { className: 'dshm-list' }, jobs.map((job) => h(JobRow, { key: job.id, job, now, t })))
        ),
        h('section', { className: 'dshm-section' },
          h('h2', { className: 'dshm-section-title' }, t('section.services')),
          h(
            'div',
            { className: 'dshm-ports' },
            h('span', { className: 'dshm-ports-label' }, `${t('services.ports')}:`),
            ports.length === 0
              ? h('span', { className: 'dshm-port' }, t('services.noPorts'))
              : ports.map((port) => h('span', { key: port, className: 'dshm-port' }, String(port)))
          ),
          services.length === 0
            ? h('div', { className: 'dshm-empty' }, t('services.empty'))
            : h(
                'div',
                { className: 'dshm-table' },
                h('div', { className: 'dshm-tr dshm-th' },
                  h('span', null, 'PID'),
                  h('span', null, 'NAME'),
                  h('span', null, 'TIME'),
                  h('span', null, 'CMD'),
                  h('span', null, '')
                ),
                services.map((svc) => {
                  const isPending = Boolean(pending[svc.pid]);
                  return h(
                    'div',
                    { key: svc.pid, className: isPending ? 'dshm-tr dshm-tr-pending' : 'dshm-tr' },
                    h('span', null, String(svc.pid)),
                    h('span', { className: 'dshm-name', title: svc.comm }, svc.name || svc.comm),
                    h('span', null, formatDuration(svc.etimes * 1000, t)),
                    h('span', { className: 'dshm-cmd', title: svc.args }, svc.args || svc.comm),
                    h('button', {
                      type: 'button',
                      className: isPending ? 'dshm-kill dshm-kill-pending' : armed === svc.pid ? 'dshm-kill dshm-kill-armed' : 'dshm-kill',
                      disabled: isPending,
                      title: isPending ? t('kill.pending') : `${t('kill.action')} ${svc.name || svc.comm} (${svc.pid})`,
                      onClick: () => killProcess(svc),
                    }, isPending ? t('kill.pending') : armed === svc.pid ? t('kill.confirm') : t('kill.action'))
                  );
                }),
                notice
                  ? h('div', { className: notice.kind === 'error' ? 'dshm-notice dshm-error' : 'dshm-notice dshm-notice-ok' }, notice.text)
                  : null
              )
        ),
        h('section', { className: 'dshm-section' },
          h('h2', { className: 'dshm-section-title' }, t('section.containers')),
          containers === undefined
            ? null
            : containers === null
              ? h('div', { className: 'dshm-empty' }, t('containers.unavailable'))
              : containers.length === 0
                ? h('div', { className: 'dshm-empty' }, t('containers.empty'))
                : h('div', { className: 'dshm-list' },
                    containers.map((container) =>
                      h('div', { key: container.name, className: 'dshm-container' },
                        h('span', { className: 'dshm-dot', style: { background: 'var(--dsw-alias-state-success-primary)' } }),
                        h('span', { className: 'dshm-container-name' }, container.name),
                        h('span', { className: 'dshm-container-status' }, container.status),
                        h('span', { className: 'dshm-container-image', title: container.image }, container.image)
                      )
                    )
                  )
        )
      );
    }

    function MonitorIcon(props) {
      const size = props.size || 16;
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M3 13h3.5l2-6 3 11 2.5-7 1.5 2H21',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M3 19h18', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', opacity: 0.45 })
      );
    }

    const CSS = `
.dshm-page { box-sizing: border-box; height: 100%; min-height: 0; flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; scrollbar-gutter: stable; --dsh-scrollbar-width: 9px; --dsh-scrollbar-thumb-border: 2px; padding: 16px 16px 32px; max-width: 100%; color: var(--dsw-alias-label-primary); }
.dshm-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.dshm-title { font-size: 20px; font-weight: 650; margin: 0; line-height: 1.3; }
.dshm-subtitle { font-size: 13px; color: var(--dsw-alias-label-secondary); margin-top: 4px; }
.dshm-updated { font-size: 12px; color: var(--dsw-alias-label-secondary); display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; }
.dshm-error { color: var(--dsw-alias-state-error-primary); }
.dshm-section { margin-bottom: 24px; }
.dshm-section-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 0 0 10px; text-transform: none; letter-spacing: 0.02em; }
.dshm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.dshm-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px; }
.dshm-card-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshm-card-value { font-size: 22px; font-weight: 650; margin-top: 4px; font-variant-numeric: tabular-nums; }
.dshm-card-extra { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 6px; font-variant-numeric: tabular-nums; }
.dshm-bar { height: 4px; border-radius: 2px; background: var(--dsw-alias-bg-layer-2); margin-top: 8px; overflow: hidden; }
.dshm-bar-fill { height: 100%; background: var(--dsw-alias-brand-primary); border-radius: 2px; transition: width 0.4s ease; }
.dshm-list { display: flex; flex-direction: column; gap: 8px; }
.dshm-job { display: flex; gap: 10px; align-items: flex-start; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 14px; }
.dshm-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none; }
.dshm-job-body { min-width: 0; flex: 1; }
.dshm-job-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshm-job-label { font-size: 14px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60ch; }
.dshm-chip { font-size: 11px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 1px 7px; font-variant-numeric: tabular-nums; }
.dshm-chip-accent { color: var(--dsw-alias-brand-primary); }
.dshm-job-meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-top: 4px; font-variant-numeric: tabular-nums; }
.dshm-job-detail { color: var(--dsw-alias-state-warn-primary); }
.dshm-empty { font-size: 13px; color: var(--dsw-alias-label-secondary); padding: 10px 2px; }
.dshm-ports { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; }
.dshm-ports-label { color: var(--dsw-alias-label-secondary); }
.dshm-port { font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 1px 8px; }
.dshm-table { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
.dshm-tr { display: grid; grid-template-columns: 56px 88px 60px minmax(0, 1fr) 64px; gap: 8px; padding: 7px 12px; font-size: 12px; font-variant-numeric: tabular-nums; border-top: 1px solid var(--dsw-alias-border-l1); align-items: center; }
.dshm-tr:first-child { border-top: none; }
.dshm-th { color: var(--dsw-alias-label-secondary); font-weight: 600; background: var(--dsw-alias-bg-layer-2); }
.dshm-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshm-cmd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); }
.dshm-kill { font-size: 11px; font-family: inherit; padding: 2px 8px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); cursor: pointer; transition: color 0.15s ease, border-color 0.15s ease; }
.dshm-kill:hover { color: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); }
.dshm-kill:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshm-kill-armed { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.dshm-tr-pending { background: var(--dsw-alias-state-warn-tertiary); }
.dshm-tr-pending .dshm-name { color: var(--dsw-alias-state-warn-primary); }
.dshm-kill-pending { background: transparent; border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); cursor: default; font-weight: 600; opacity: 1; }
.dshm-kill:disabled { cursor: default; }
.dshm-notice { font-size: 12px; padding: 7px 12px; }
.dshm-notice-ok { color: var(--dsw-alias-state-success-primary); }
.dshm-container { display: flex; align-items: center; gap: 10px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 9px 14px; font-size: 13px; }
.dshm-container .dshm-dot { margin-top: 0; }
.dshm-container-name { font-weight: 600; }
.dshm-container-status { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshm-container-image { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 45ch; }
@media (max-width: 720px) {
  .dshm-tr { grid-template-columns: 48px 80px minmax(0, 1fr) 60px; }
  .dshm-tr > :nth-child(3) { display: none; }
}
`;

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-monitor: locale');
        const t = ctx.locale.bind(NS);
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'builtin',
              title: () => t('title'),
              guide: [
                {
                  id: 'monitor',
                  order: 60,
                  title: () => t('title'),
                  description: () => t('subtitle'),
                  icon: MonitorIcon,
                },
              ],
            }),
          'dsh-monitor: tab type'
        );
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register(
                { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: () => ({ t }) },
                MonitorPage
              )
            ),
          'dsh-monitor: tab body'
        );
        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.dshMonitor = '1';
          style.textContent = CSS;
          document.head.append(style);
          return () => style.remove();
        }, 'dsh-monitor: styles');
      },
    };
  },
});
