/**
 * @local/panel-drawer — 侧栏二级抽屉
 *
 * 一个通用机制：把 `sidebar.panellist` / `sidebar.footer.action` 里的入口
 * 收进一个抽屉浮层，侧栏只留一个「工具抽屉」图标。
 * - 收进抽屉的条目：原按钮由注入样式（aria-label 选择器）+ DOM 同步兜底隐藏；
 * - 抽屉行点击：main 注册过的面板走 ctx.layout.selectPanel，其余点击原按钮；
 * - 配置存 localStorage（key: dsh.panel-drawer.config.v1），管理页支持
 *   拖拽/按钮 在「留在侧栏 ↔ 抽屉内」两栏间移动并排序，改动即时生效。
 */
window.__ModuleLoader__.load({
  id: '@local/panel-drawer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'panel-drawer';
    const STORE_KEY = 'dsh.panel-drawer.config.v1';
    const OUR_PANELLIST_ID = 'panel-drawer';

    const zh = {
      'row.label': '工具抽屉',
      'panel.title': '工具',
      'panel.manage': '管理入口…',
      'panel.empty': '抽屉是空的 — 到「管理入口」把条目拖进来',
      'mgr.title': '侧栏抽屉 · 入口管理',
      'mgr.hint': '把条目在两栏之间拖动即可收进 / 放出抽屉；在「抽屉内」栏上下拖动可排序。改动立即生效并自动保存。',
      'mgr.left': '留在侧栏',
      'mgr.right': '抽屉内',
      'mgr.toDrawer': '收进抽屉 →',
      'mgr.toSidebar': '← 放回侧栏',
      'settings.label': '侧栏抽屉',
    };
    const en = {
      'row.label': 'Tools drawer',
      'panel.title': 'Tools',
      'panel.manage': 'Manage entries…',
      'panel.empty': 'Drawer is empty — open “Manage entries” and drag items in.',
      'mgr.title': 'Sidebar drawer · Entry manager',
      'mgr.hint': 'Drag entries between the two columns to move them in/out of the drawer; drag inside the right column to reorder. Changes apply immediately and are saved automatically.',
      'mgr.left': 'Stay in sidebar',
      'mgr.right': 'In drawer',
      'mgr.toDrawer': 'Move to drawer →',
      'mgr.toSidebar': '← Move to sidebar',
      'settings.label': 'Sidebar drawer',
    };

    /* ---------------- config store ---------------- */

    /** Static knowledge about known entries (locale variants, stable selectors).
     *  Lives independently of the user's drawer membership so an entry released
     *  from the drawer stays identifiable and can be moved back in. */
    const CATALOG = {
      'skill-explorer': { altLabels: ['Skill Center'] },
      'task-board': { altLabels: ['Task Board'] },
      'context-overview': { altLabels: ['Context Insights'], selector: 'button.lc-ov-entry' },
    };
    const metaOf = (e) => ({ ...(CATALOG[e.id] || {}), ...e });

    const DEFAULT_CONFIG = {
      drawer: [
        { id: 'skill-explorer', slot: 'sidebar.panellist', label: '技能中心' },
        { id: 'task-board', slot: 'sidebar.panellist', label: '任务看板' },
        { id: 'context-overview', slot: 'sidebar.footer.action', label: '上下文洞察' },
      ],
    };

    function loadConfig() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.drawer)) {
            return {
              drawer: parsed.drawer.filter(
                (e) => e && typeof e.id === 'string' && typeof e.slot === 'string'
              ),
            };
          }
        }
      } catch (_) {}
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    function saveConfig(config) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(config));
      } catch (_) {}
    }

    const store = (() => {
      let state = { open: false, config: loadConfig() };
      const subs = new Set();
      const emit = () => subs.forEach((f) => { try { f(); } catch (_) {} });
      return {
        get: () => state,
        setOpen(open) { if (state.open !== open) { state = { ...state, open }; emit(); } },
        toggle() { this.setOpen(!state.open); },
        setConfig(config) { state = { ...state, config }; saveConfig(config); emit(); },
        sub(fn) { subs.add(fn); return () => subs.delete(fn); },
      };
    })();

    /* ---------------- slot helpers ---------------- */

    const WATCHED_SLOTS = ['sidebar.panellist', 'sidebar.footer.action'];

    function entriesOf(ctx, slot) {
      try {
        const fn = ctx.slots && ctx.slots.entriesOfSlot;
        if (typeof fn !== 'function') return [];
        return fn.call(ctx.slots, slot) || [];
      } catch (_) { return []; }
    }

    function resolveLabel(ctx, slot, id) {
      const found = entriesOf(ctx, slot).find((e) => e.options && e.options.id === id);
      if (!found) return undefined;
      const label = found.options.label;
      if (typeof label === 'function') {
        try { const v = label(); return typeof v === 'string' && v ? v : undefined; }
        catch (_) { return undefined; }
      }
      return typeof label === 'string' && label ? label : undefined;
    }

    /** Best human label for an entry: live registration label → selector-derived
     *  aria-label (covers slot entries without a label option) → config → id. */
    function entryLabel(ctx, e) {
      e = metaOf(e);
      const live = resolveLabel(ctx, e.slot, e.id);
      if (live) return live;
      if (e.selector) {
        try {
          const el = document.querySelector(e.selector);
          const al = el && el.getAttribute('aria-label');
          if (al) return al;
        } catch (_) {}
      }
      return e.label || e.id;
    }

    /** Live inventory of every movable entry across both slots. */
    function inventory(ctx) {
      const cfg = store.get().config;
      const out = [];
      for (const slot of WATCHED_SLOTS) {
        for (const e of entriesOf(ctx, slot)) {
          const id = e.options && e.options.id;
          if (!id || id === OUR_PANELLIST_ID) continue;
          const known = cfg.drawer.find((x) => x.slot === slot && x.id === id) || {};
          const label = entryLabel(ctx, { slot, id, ...known });
          const inConfig = !!cfg.drawer.find((x) => x.slot === slot && x.id === id);
          // Skip unidentifiable helper entries (no human label) unless already in the drawer.
          if (!inConfig && (!label || !label.trim() || label === id)) continue;
          out.push({ slot, id, label: label || id });
        }
      }
      return out;
    }

    function findLiveButton(ctx, entry) {
      entry = metaOf(entry);
      const cands = [];
      const push = (l) => { if (l && !cands.includes(l)) cands.push(l); };
      push(resolveLabel(ctx, entry.slot, entry.id));
      push(entry.label);
      (entry.altLabels || []).forEach(push);
      const buttons = Array.from(document.querySelectorAll('button,[role="button"]')).filter(
        (b) => !b.closest('[data-panel-drawer]')
      );
      if (entry.selector) {
        try {
          const sel = document.querySelector(entry.selector);
          if (sel) return sel;
        } catch (_) {}
      }
      for (const l of cands) {
        const hit =
          buttons.find((b) => (b.getAttribute('aria-label') || '').trim() === l) ||
          buttons.find((b) => (b.textContent || '').trim() === l) ||
          buttons.find((b) => ((b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '')).includes(l));
        if (hit) return hit;
      }
      return null;
    }

    function openEntry(ctx, entry) {
      if (entry.slot === 'sidebar.panellist') {
        try { ctx.layout.selectPanel(entry.id); return; } catch (_) {}
      }
      const btn = findLiveButton(ctx, entry);
      if (btn) { btn.click(); return; }
      try { ctx.layout.selectPanel(entry.id); } catch (_) {}
    }

    /* ---------------- hiding ---------------- */

    function cssq(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

    function hideLabels(ctx, config) {
      const out = [];
      const push = (l) => { if (l && l !== 'panel-drawer' && !out.includes(l)) out.push(l); };
      for (const raw of config.drawer) {
        const e = metaOf(raw);
        push(resolveLabel(ctx, e.slot, e.id)); // live locale-resolved label
        push(e.label);                          // configured label
        (e.altLabels || []).forEach(push);      // cross-locale variants
      }
      return out;
    }

    function buildHideCss(ctx, config) {
      const rules = [];
      for (const raw of config.drawer) {
        const e = metaOf(raw);
        if (e.selector) rules.push(`${e.selector}{display:none!important}`);
      }
      for (const l of hideLabels(ctx, config)) {
        rules.push(`button[aria-label="${cssq(l)}"],[role="button"][aria-label="${cssq(l)}"]{display:none!important}`);
      }
      return rules.join('\n');
    }

    /** DOM sync fallback: exact text/aria match, restores entries moved back. */
    function applyDomHide(ctx, config) {
      const labels = hideLabels(ctx, config);
      const selSet = new Set();
      for (const raw of config.drawer) {
        const e = metaOf(raw);
        if (!e.selector) continue;
        try { document.querySelectorAll(e.selector).forEach((el) => selSet.add(el)); } catch (_) {}
      }
      const nodes = document.querySelectorAll('button,[role="button"]');
      for (const el of nodes) {
        if (el.closest('[data-panel-drawer]')) continue;
        const aria = (el.getAttribute('aria-label') || '').trim();
        const text = (el.textContent || '').trim();
        const hit = selSet.has(el) || labels.some((l) => aria === l || text === l);
        if (hit) {
          if (el.getAttribute('data-pd-hidden') !== '1') {
            el.setAttribute('data-pd-hidden', '1');
            el.style.setProperty('display', 'none', 'important');
          }
        } else if (el.getAttribute('data-pd-hidden') === '1') {
          el.removeAttribute('data-pd-hidden');
          el.style.removeProperty('display');
        }
      }
    }

    /* ---------------- components ---------------- */

    /** Our single sidebar row glyph: a 2x2 grid with one slot open.
     *  The shell passes {size, active}; size is the icon cell size (16 wide / 18 rail). */
    function DrawerGlyph(props) {
      const size = (props && props.size) || 16;
      return h(
        'span',
        {
          'data-panel-drawer-glyph': '1',
          onClick: (e) => { e.stopPropagation(); store.toggle(); },
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: size, height: size, flex: '0 0 auto', cursor: 'pointer',
          },
        },
        h(
          'svg',
          { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true',
            fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' },
          h('rect', { x: 1.5, y: 1.5, width: 5, height: 5, rx: 1 }),
          h('rect', { x: 9.5, y: 1.5, width: 5, height: 5, rx: 1 }),
          h('rect', { x: 1.5, y: 9.5, width: 5, height: 5, rx: 1 }),
          h('path', { d: 'M9.5 12h5M12 9.5v5' })
        )
      );
    }

    function useStoreTick() {
      const [, force] = React.useReducer((x) => x + 1, 0);
      React.useEffect(() => store.sub(force), []);
    }

    function rowGlyph(ctx, entry) {
      try {
        if (typeof ctx.slots.render === 'function') {
          const node = ctx.slots.render(entry.slot, { size: 16, active: false }, { only: entry.id });
          if (node) return node;
        }
      } catch (_) {}
      return null;
    }

    /** The flyout: rendered into shell.overlay (frame-wide floating layer). */
    function Flyout({ ctx }) {
      useStoreTick();
      const s = store.get();
      const [pos, setPos] = React.useState(null);
      React.useLayoutEffect(() => {
        if (!s.open) { setPos(null); return; }
        const place = () => {
          const glyph = document.querySelector('[data-panel-drawer-glyph]');
          const btn = glyph && glyph.closest('button');
          if (btn) {
            const r = btn.getBoundingClientRect();
            setPos({
              top: Math.max(8, Math.min(r.top, window.innerHeight - 160)),
              left: r.right + 8,
            });
          } else setPos({ top: 80, left: 72 });
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
      }, [s.open]);

      if (!s.open) return null;
      const t = ctx.locale.bind(NS);
      const entries = s.config.drawer;

      return h(
        'div',
        {
          'data-pd-backdrop': '1',
          onClick: () => store.setOpen(false),
          style: { position: 'fixed', inset: 0, zIndex: 998, background: 'transparent' },
        },
        pos &&
          h(
            'div',
            {
              'data-panel-drawer': '1',
              onClick: (e) => e.stopPropagation(),
              role: 'menu',
              style: {
                position: 'absolute', left: pos.left, top: pos.top,
                minWidth: 184, maxWidth: 300, padding: '6px',
                background: 'var(--dsw-alias-bg-overlay)',
                border: '1px solid var(--dsw-alias-border-l1)',
                borderRadius: '10px',
                boxShadow: '0 8px 28px rgba(0,0,0,.28)',
                color: 'var(--dsw-alias-label-primary)',
                fontSize: 13,
              },
            },
            h(
              'div',
              { style: { padding: '4px 8px 6px', fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              t('panel.title')
            ),
            entries.length === 0 &&
              h(
                'div',
                { style: { padding: '8px', color: 'var(--dsw-alias-label-secondary)' } },
                t('panel.empty')
              ),
            entries.map((entry) =>
              h(
                'div',
                {
                  key: entry.slot + ':' + entry.id,
                  role: 'menuitem',
                  onClick: () => { store.setOpen(false); openEntry(ctx, entry); },
                  style: {
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '7px 8px', borderRadius: '7px', cursor: 'pointer',
                  },
                  onMouseEnter: (e) => (e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2)'),
                  onMouseLeave: (e) => (e.currentTarget.style.background = 'transparent'),
                },
                h(
                  'span',
                  { style: { width: 16, height: 16, display: 'flex', alignItems: 'center', flex: '0 0 auto' } },
                  rowGlyph(ctx, entry)
                ),
                h(
                  'span',
                  { style: { flex: '1 1 auto', whiteSpace: 'nowrap' } },
                  entryLabel(ctx, entry)
                )
              )
            ),
            h('div', { style: { height: 1, margin: '6px 4px', background: 'var(--dsw-alias-border-l1)' } }),
            h(
              'div',
              {
                role: 'menuitem',
                onClick: () => {
                  store.setOpen(false);
                  try { ctx.layout.selectPanel(OUR_PANELLIST_ID); } catch (_) {}
                },
                style: {
                  padding: '7px 8px', borderRadius: '7px', cursor: 'pointer',
                  color: 'var(--dsw-alias-label-secondary)',
                },
                onMouseEnter: (e) => (e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2)'),
                onMouseLeave: (e) => (e.currentTarget.style.background = 'transparent'),
              },
              '⚙ ' + t('panel.manage')
            )
          )
      );
    }

    /** Two-column drag manager; the same component backs the main panel and the settings page. */
    function Manager({ ctx }) {
      useStoreTick();
      const s = store.get();
      const t = ctx.locale.bind(NS);
      const inv = inventory(ctx);
      const inDrawer = new Set(s.config.drawer.map((e) => e.slot + ' ' + e.id));

      const left = inv.filter((x) => !inDrawer.has(x.slot + ' ' + x.id));
      const right = s.config.drawer.map(
        (e) => inv.find((x) => x.slot === e.slot && x.id === e.id) || { ...e, label: e.label || e.id }
      );

      const [drag, setDrag] = React.useState(null); // { item, from }

      const commit = (nextDrawer) => store.setConfig({ drawer: nextDrawer });

      const move = (item, to, beforeId) => {
        const rest = s.config.drawer.filter((e) => !(e.slot === item.slot && e.id === item.id));
        if (to === 'sidebar') { commit(rest); return; }
        const entry = { id: item.id, slot: item.slot, label: item.label };
        if (!beforeId) { commit([...rest, entry]); return; }
        const at = rest.findIndex((e) => e.slot + ' ' + e.id === beforeId);
        const target = at === -1 ? rest.length : at;
        rest.splice(target, 0, entry);
        commit(rest);
      };

      const colStyle = {
        flex: '1 1 0', minWidth: 0, padding: '10px',
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-1)',
      };
      const rowStyle = {
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '7px 8px', margin: '4px 0', borderRadius: '7px', cursor: 'grab',
        background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', fontSize: 13,
      };
      const btnStyle = {
        border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '6px',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12, padding: '2px 8px', cursor: 'pointer', flex: '0 0 auto',
      };

      const renderRow = (item, from, mayNest) =>
        h(
          'div',
          {
            key: item.slot + ':' + item.id,
            draggable: true,
            onDragStart: (e) => {
              setDrag({ item, from });
              try { e.dataTransfer.setData('text/plain', item.id); } catch (_) {}
            },
            onDragEnd: () => setDrag(null),
            onDragOver: (e) => { if (mayNest) e.preventDefault(); },
            onDrop: (e) => {
              if (!mayNest || !drag) return;
              e.preventDefault(); e.stopPropagation();
              move(drag.item, 'drawer', item.slot + ' ' + item.id);
              setDrag(null);
            },
            style: rowStyle,
          },
          h(
            'span',
            { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            item.label || item.id
          ),
          from === 'drawer'
            ? h('button', { type: 'button', style: btnStyle, onClick: () => move(item, 'sidebar') }, t('mgr.toSidebar'))
            : h('button', { type: 'button', style: btnStyle, onClick: () => move(item, 'drawer') }, t('mgr.toDrawer'))
        );

      const dropCol = (to) => (e) => {
        if (!drag) return;
        e.preventDefault();
        move(drag.item, to);
        setDrag(null);
      };

      return h(
        'div',
        { style: { padding: '20px 24px', color: 'var(--dsw-alias-label-primary)', maxWidth: 860 } },
        h('h2', { style: { margin: '0 0 6px', fontSize: 16 } }, t('mgr.title')),
        h('p', { style: { margin: '0 0 14px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('mgr.hint')),
        h(
          'div',
          { style: { display: 'flex', gap: '14px', alignItems: 'stretch' } },
          h(
            'div',
            { style: colStyle, onDragOver: (e) => e.preventDefault(), onDrop: dropCol('sidebar') },
            h(
              'div',
              { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '0 0 6px' } },
              t('mgr.left') + ' (' + left.length + ')'
            ),
            left.map((item) => renderRow(item, 'sidebar', false))
          ),
          h(
            'div',
            { style: colStyle, onDragOver: (e) => e.preventDefault(), onDrop: dropCol('drawer') },
            h(
              'div',
              { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '0 0 6px' } },
              t('mgr.right') + ' (' + right.length + ')'
            ),
            right.map((item) => renderRow(item, 'drawer', true)),
            right.length === 0 &&
              h(
                'div',
                { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', padding: '6px 2px' } },
                t('panel.empty')
              )
          )
        )
      );
    }

    /* ---------------- plugin body ---------------- */

    return {
      inject: ['slots', 'layout', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'panel-drawer: dictionaries');
        const t = ctx.locale.bind(NS);

        const disposers = [];
        disposers.push(
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: OUR_PANELLIST_ID, order: 50, label: () => t('row.label') },
              DrawerGlyph
            )
          )
        );
        disposers.push(
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              { name: 'shell.overlay', id: OUR_PANELLIST_ID, order: 900 },
              () => h(Flyout, { ctx })
            )
          )
        );
        disposers.push(
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: OUR_PANELLIST_ID }, () => h(Manager, { ctx }))
          )
        );
        disposers.push(
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: OUR_PANELLIST_ID, order: 90, label: () => t('settings.label') },
              () => h(Manager, { ctx })
            )
          )
        );

        // hide stylesheet + DOM sync
        const styleEl = document.createElement('style');
        styleEl.setAttribute('data-panel-drawer', '1');
        document.head.appendChild(styleEl);
        const sync = () => {
          try {
            styleEl.textContent = buildHideCss(ctx, store.get().config);
            applyDomHide(ctx, store.get().config);
          } catch (_) {}
        };
        sync();
        const unsubStore = store.sub(sync);
        const unsubSlots = [];
        for (const slot of WATCHED_SLOTS) {
          try {
            const un = ctx.slots.subscribe(slot, sync);
            if (typeof un === 'function') unsubSlots.push(un);
          } catch (_) {}
        }
        let timer = null;
        const obs = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(sync, 250);
        });
        obs.observe(document.body, {
          childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'],
        });

        // Whole-row click → drawer: intercept our row's click at capture phase,
        // before it reaches the shell's row handler (selectPanel → manager page).
        // The 16px glyph alone is too small a target; Enter synthesizes the same click.
        const onRowClick = (e) => {
          try {
            const target = e.target;
            if (!target || typeof target.closest !== 'function') return;
            const btn = target.closest('button');
            if (!btn || !btn.querySelector('[data-panel-drawer-glyph]')) return;
            e.stopPropagation();
            store.toggle();
          } catch (_) {}
        };
        document.addEventListener('click', onRowClick, true);

        ctx.effect(
          () => () => {
            document.removeEventListener('click', onRowClick, true);
            unsubStore();
            unsubSlots.forEach((un) => { try { un(); } catch (_) {} });
            obs.disconnect();
            clearTimeout(timer);
            styleEl.remove();
            disposers.forEach((d) => { try { d(); } catch (_) {} });
            applyDomHide(ctx, { drawer: [] }); // restore any hidden foreign buttons
          },
          'panel-drawer: cleanup'
        );
      },
    };
  },
});
