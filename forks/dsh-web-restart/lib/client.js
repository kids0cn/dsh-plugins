/**
 * dsh-web-restart — client half.
 *
 * Hand-written bundle in the exact wire format the DSH web shell expects:
 * a CJS factory handed to window.__ModuleLoader__.load({ id, factory }),
 * with platform modules (react) resolved through the injected require.
 * Registers the "重启 DSH" button in sidebar.footer.action; a single click
 * POSTs /restart-dsh (no confirmation step). A status dot next to the button
 * polls GET /dsh-health every 5s (green = online, red = offline/restarting).
 */
window.__ModuleLoader__.load({
  id: 'dsh-web-restart',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var inject = ['slots'];

    // ── 模块级看门狗 v3：点过重启 → 掉线 → 恢复后自动刷新（零操作）──
    // v1 教训：跟踪写在按钮组件 effect 里，断线时 shell 卸载侧栏 → effect cleanup 跑掉，
    //          看门狗陪葬，症状 = "还得手动刷新"。→ 挪到模块作用域，与 React 树无关。
    // v2 教训：状态只放 sessionStorage —— storage 被禁/隐私模式时 armWatch **静默失效**；
    //          health fetch 没有超时 —— 代理挂住连接时 tick 永久卡死。
    // v3：内存旗标为主（永不失效），sessionStorage 只做"掉线期间页面被重载"的接力；
    //     fetch 带 2.5s AbortController 超时；armed/down/reload 发 /dsh-watch 信标进
    //     host journal —— 前端有没有盯、有没有下令刷新，可诊断，不再盲猜。
    var WATCH_KEY = 'dsh-restart-watch';
    var watching = false;
    var watchMem = null;                       // 内存旗标（主，不依赖任何浏览器存储）

    function readStore() {
      try {
        var raw = window.sessionStorage.getItem(WATCH_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    }
    function writeStore(w) { try { window.sessionStorage.setItem(WATCH_KEY, JSON.stringify(w)); } catch (e) {} }
    function clearStore() { try { window.sessionStorage.removeItem(WATCH_KEY); } catch (e) {} }
    function readWatch() { return watchMem || readStore(); }
    function saveWatch(w) { watchMem = w; writeStore(w); }
    function dropWatch() { watchMem = null; clearStore(); }

    /** 单向信标 → host journal（成败都不管，只为诊断）。 */
    function beacon(ev, reason) {
      try {
        var url = '/dsh-watch?e=' + encodeURIComponent(ev) + (reason ? '&reason=' + encodeURIComponent(reason) : '');
        if (typeof navigator !== 'undefined' && navigator.sendBeacon && navigator.sendBeacon(url)) return;
        fetch(url, { keepalive: true }).catch(function () {});
      } catch (e) {}
    }

    /** 带超时的健康探测：2.5s 不回就 abort，防止 tick 被挂死的连接卡住。 */
    function fetchHealth() {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 2500) : null;
      var done = function (fn) { return function (v) { if (timer) clearTimeout(timer); return fn(v); }; };
      return fetch('/dsh-health', { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
        .then(function (res) { if (!res.ok) throw new Error('down'); return res.json(); })
        .then(done(function (data) { return data; }), done(function (err) { throw err; }));
    }

    // ── 静默刷新（v5，用户拍板 A+C）──
    // A：标签页不可见 → 直接刷（本来就看不见，不必冻帧）
    // C：可见 → 刷新前把当前帧冻进 sessionStorage（去 script/iframe），并把背景色+主题类名
    //    塞进短 cookie（跨导航必达；sessionStorage 被禁时退化成 B 纯色）；新页面启动即把冻帧
    //    原样铺满屏（pointer-events:none 不挡操作），app 首绘（load+0.9s）后 0.3s 淡出，
    //    10s 硬兜底必揭开。
    var RF_COOKIE = 'dsh-rf';
    var RF_HTML_KEY = 'dsh-restart-freeze-html';

    function setRfCookie(val) {
      try { document.cookie = RF_COOKIE + '=' + encodeURIComponent(val) + ';path=/;max-age=120'; } catch (e) {}
    }
    function readRfCookie() {
      try {
        var parts = ('; ' + document.cookie).split('; ' + RF_COOKIE + '=');
        if (parts.length < 2) return null;
        return decodeURIComponent(parts[1].split(';')[0]);
      } catch (e) { return null; }
    }
    function clearRfCookie() {
      try { document.cookie = RF_COOKIE + '=;path=/;max-age=0'; } catch (e) {}
    }

    /** 导航前：把当前帧冻起来（后台标签页跳过 —— A）。 */
    function freezeFrame() {
      try {
        if (typeof document === 'undefined' || !document.body) return;
        if (document.hidden) return;                          // A：不可见 → 静默直接刷
        var bg = '';
        var cls = '';
        try {
          bg = (window.getComputedStyle && window.getComputedStyle(document.documentElement).backgroundColor) || '';
          cls = document.documentElement.className || '';
        } catch (e) {}
        setRfCookie(JSON.stringify({ bg: bg, cls: cls }));
        var copy = document.body.cloneNode(true);
        var junk = copy.querySelectorAll('script,iframe,object,embed,noscript');
        for (var i = 0; i < junk.length; i++) {
          if (junk[i].parentNode) junk[i].parentNode.removeChild(junk[i]);
        }
        try { window.sessionStorage.setItem(RF_HTML_KEY, copy.innerHTML); } catch (e) {}  // 超配额 → 只剩纯色
      } catch (e) { /* 冻失败就退回普通刷新 */ }
    }

    /** 新页面启动：铺上冻帧，app 首绘后揭开。 */
    function unfreezeOverlay() {
      var meta = null;
      try { meta = readRfCookie(); } catch (e) {}
      var html = null;
      try { html = window.sessionStorage.getItem(RF_HTML_KEY); } catch (e) {}
      if (!meta) {                                             // 没有旗标 → 顺手清孤儿键
        if (html) { try { window.sessionStorage.removeItem(RF_HTML_KEY); } catch (e) {} }
        return;
      }
      clearRfCookie();
      try { window.sessionStorage.removeItem(RF_HTML_KEY); } catch (e) {}
      var info = {};
      try { info = JSON.parse(meta) || {}; } catch (e) {}
      var layer = null;
      try {
        layer = document.createElement('div');
        layer.id = 'dsh-restart-freeze';
        layer.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;'
          + 'pointer-events:none;overflow:hidden;transition:opacity .3s ease;'
          + 'background:' + (info.bg || '#ffffff') + ';';
        if (info.cls) { try { layer.className = info.cls; } catch (e) {} }  // 主题类名随层走，CSS 变量才对
        if (html) layer.innerHTML = html;                      // 没 html 就是 B：纯色一闪
        (document.body || document.documentElement).appendChild(layer);
      } catch (e) { layer = null; }
      if (!layer) return;
      var done = false;
      var reveal = function () {
        if (done) return;
        done = true;
        try { layer.style.opacity = '0'; } catch (e) {}
        setTimeout(function () {
          try { if (layer.parentNode) layer.parentNode.removeChild(layer); } catch (e) {}
        }, 320);
      };
      var arm = function () { setTimeout(reveal, 900); };      // load 后再留 0.9s 等 app 首绘
      try {
        if (document.readyState === 'complete') arm();
        else window.addEventListener('load', arm);
      } catch (e) { arm(); }
      setTimeout(reveal, 10000);                               // 硬兜底：任何情况 10s 必揭开
    }

    /** 恢复后的导航：URL 还挂着 ?token=（重启后必失效）→ 去掉 query 走 cookie；否则原地刷新。 */
    function navigateAfterRecovery() {
      freezeFrame();                                           // C：先把这一帧冻住（后台则跳过）
      try {
        if (/[?&]token=/.test(window.location.search)) {
          window.location.replace(window.location.pathname + window.location.hash);
          return;
        }
      } catch (e) {}
      window.location.reload();
    }

    /** 点击重启时调用：立旗（内存+存储）+ 信标 + 启动看门狗。 */
    function armWatch() {
      saveWatch({ armedAt: Date.now(), pid: null, sawDown: false });
      beacon('armed');
      startWatch();
    }

    // ── 唤醒钩子（v4）：后台标签页的定时器会被浏览器限流到 ≈1 次/分钟（23:14 实测：
    //    恢复后等了 70 秒才刷新）。标签页重新可见 / 聚焦 / 网络恢复 → 立刻探测一次。
    var busy = false;                          // 已有探测在途（防并行 tick 环）
    var tickFn = null;
    var wakeAttached = false;
    function attachWake() {
      if (wakeAttached || typeof window === 'undefined') return;
      wakeAttached = true;
      var wake = function () { if (watching && !busy && tickFn) tickFn(); };
      try {
        if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', wake);
        window.addEventListener('focus', wake);
        window.addEventListener('online', wake);
      } catch (e) {}
    }

    function startWatch() {
      if (watching || typeof window === 'undefined') return;
      if (!readWatch()) return;
      watching = true;
      attachWake();
      var tick = function () {
        if (!watching || busy) return;
        var w = readWatch();
        if (!w) { watching = false; return; }
        // 3 分钟没等到恢复就放弃（POST 没成功/重启没发生时防永久轮询）
        if (Date.now() - (w.armedAt || 0) > 180000) { dropWatch(); watching = false; return; }
        busy = true;
        var settle = function () {
          busy = false;
          if (watching) setTimeout(tick, 1000);
        };
        fetchHealth()
          .then(function (data) {
            var cur = readWatch();
            if (!cur) { watching = false; busy = false; return; }
            var pid = data && typeof data.pid === 'number' ? data.pid : null;
            // 掉线前先把旧 pid 记下（pid 变了 = host 换了进程）
            if (cur.pid == null && !cur.sawDown && pid != null) { cur.pid = pid; saveWatch(cur); }
            var reason = (pid != null && cur.pid != null && pid !== cur.pid) ? 'pid-changed'
                       : (cur.sawDown ? 'recovered' : null);
            if (reason) {
              beacon('reload', reason);
              dropWatch();
              watching = false;
              busy = false;
              navigateAfterRecovery();
              return;
            }
            settle();
          })
          .catch(function () {
            var cur = readWatch();
            if (!cur) { watching = false; busy = false; return; }
            // 此刻服务器正宕着，beacon('down') 必然送不到 —— 不发（发了也没用，还会误导诊断）
            if (!cur.sawDown) { cur.sawDown = true; saveWatch(cur); }
            settle();
          });
      };
      tickFn = tick;
      tick();
    }
    // 页面加载时若还有未消费的标记（掉线期间被重载过），接上继续盯
    if (typeof window !== 'undefined' && readWatch()) startWatch();
    // 静默刷新：铺上一帧冻帧（无 cookie 旗标时零成本直接返回）
    if (typeof window !== 'undefined' && typeof document !== 'undefined') unfreezeOverlay();

    function apply(ctx) {
      // ── stylesheet (package-owned, cleaned up on teardown) ──
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        var existing = document.querySelector('style[data-dsh-web-restart-css]');
        if (existing !== null) return () => {};
        var tag = document.createElement('style');
        tag.dataset.dshRestartButtonCss = '1';
        tag.textContent = [
          '.zai-restart-dsh{flex:none;align-items:center;width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:transparent;border:none;border-radius:12px;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden;position:relative}',
          '.zai-restart-dsh:hover{background:var(--dsw-alias-bg-layer-2)}',
          '.zai-restart-dsh--armed{color:var(--dsw-alias-state-error-primary)}',
          '.zai-restart-dsh--armed:hover{background:var(--dsw-alias-state-error-primary);color:#fff}',
          '.zai-restart-dsh--rail{width:36px;height:36px;border-radius:50%;justify-content:center;gap:0;padding:0}',
          '.zai-restart-dsh__label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
          '.zai-dsh-dot{flex:none;width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--dsw-alias-label-tertiary)}',
          '.zai-dsh-dot--ok{background:#22c55e;box-shadow:0 0 4px rgba(34,197,94,.6)}',
          '.zai-dsh-dot--down{background:#ef4444;box-shadow:0 0 4px rgba(239,68,68,.6)}',
          '.zai-dsh-dot--unknown{background:var(--dsw-alias-label-tertiary)}',
          '.zai-restart-dsh--rail .zai-dsh-dot{position:absolute;top:2px;right:2px;width:7px;height:7px}',
          '.zai-restart-dsh__status{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px;white-space:nowrap}'
        ].join('\n');
        document.head.appendChild(tag);
        return () => { tag.remove(); };
      }, 'dsh-web-restart: stylesheet');

      // ── footer action button + online status dot ──
      ctx.effect(() => {
        var disposeSlot = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'restart-dsh',
          order: -100,
          label: () => '重启 DSH'
        }, (props) => {
          var wide = props.wide;
          var phaseState = React.useState('idle');
          var phase = phaseState[0];
          var setPhase = phaseState[1];
          var messageState = React.useState('');
          var message = messageState[0];
          var setMessage = messageState[1];
          // 在线状态：'checking' | 'ok' | 'down'
          var healthState = React.useState('checking');
          var health = healthState[0];
          var setHealth = healthState[1];

          // 每 5 秒探测 /dsh-health；fetch 失败或非 200 视为离线 —— 只管状态灯。
          // 断线恢复后的自动刷新不在这做（组件会被卸载），在上面的模块级看门狗里。
          React.useEffect(function () {
            var check = function () {
              fetch('/dsh-health', { method: 'GET' })
                .then(function (res) { return res.ok ? setHealth('ok') : setHealth('down'); })
                .catch(function () { setHealth('down'); });
            };
            check();
            var timer = setInterval(check, 5000);
            return function () { clearInterval(timer); };
          }, []);

          // 单击直接重启（无二次确认）：先立看门狗再 POST（掉线期间靠 sessionStorage 接力）
          var click = () => {
            if (phase === 'sending' || phase === 'done') return;
            setPhase('sending');
            armWatch();
            fetch('/restart-dsh', { method: 'POST' })
              .then((res) => res.json().catch(() => null))
              .then((data) => {
                setPhase('done');
                setMessage((data && data.message) || '重启已触发');
              })
              .catch((err) => {
                setPhase('error');
                setMessage(String((err && err.message) || err));
              });
          };

          var label = phase === 'sending' ? '重启中…'
            : phase === 'done' ? '已触发'
            : phase === 'error' ? '失败'
            : '重启 DSH';
          var title = phase === 'done' ? message
            : phase === 'error' ? message
            : '点击后 DSH 将重启（断开数秒，恢复后自动刷新）';
          var cls = 'zai-restart-dsh'
            + (wide ? '' : ' zai-restart-dsh--rail')
            + (phase === 'sending' || phase === 'done' ? ' zai-restart-dsh--armed' : '');
          var statusText = health === 'ok' ? 'DSH 在线'
            : health === 'down' ? 'DSH 离线'
            : '检测中…';
          var dotCls = 'zai-dsh-dot'
            + (health === 'ok' ? ' zai-dsh-dot--ok'
              : health === 'down' ? ' zai-dsh-dot--down'
              : ' zai-dsh-dot--unknown');

          return React.createElement('button', {
            type: 'button',
            className: cls,
            onClick: click,
            title: title,
            'aria-label': '重启 DSH',
            disabled: phase === 'sending'
          }, [
            React.createElement('svg', {
              width: 14,
              height: 14,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round'
            }, [
              React.createElement('path', { d: 'M23 4v6h-6' }),
              React.createElement('path', { d: 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10' })
            ]),
            wide && React.createElement('span', { className: 'zai-restart-dsh__label' }, label),
            wide && React.createElement('span', { className: 'zai-restart-dsh__status' }, statusText),
            React.createElement('span', {
              className: dotCls,
              title: statusText,
              'aria-label': statusText
            })
          ]);
        }));
        return () => disposeSlot();
      }, 'dsh-web-restart: footer action');
    }

    module.exports = { apply: apply, inject: inject };
    return module.exports;
  }
});
