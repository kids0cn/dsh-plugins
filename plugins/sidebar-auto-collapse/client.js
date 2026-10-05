window.__ModuleLoader__.load({
  id: '@local/sidebar-auto-collapse',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'sidebarAutoCollapse';
    /** Browser-side preference key; the shell keeps no sidebar state of its own. */
    const STORAGE_KEY = 'dsh.sidebar.autoCollapse';
    /** Hover-in expands immediately. */
    const EXPAND_DELAY_MS = 0;
    /** Hover-out waits, so a pointer crossing the edge does not flicker the column. */
    const COLLAPSE_DELAY_MS = 160;
    /** The anchor spans the column's content box; this covers its inline padding. */
    const EDGE_TOLERANCE_PX = 16;

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'row.title': '自动收起左侧栏',
      'row.description': '开启后左侧栏自动折叠；鼠标移到侧边栏上自动展开，移开后自动收起。'
    };
    /** English dictionary, same key set. */
    const en = {
      'row.title': 'Auto-collapse left sidebar',
      'row.description': 'Collapses the sidebar automatically; hovering over it expands it, and moving away collapses it again.'
    };

    function readStored() {
      try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
      } catch {
        return false;
      }
    }

    function writeStored(enabled) {
      try {
        if (enabled) globalThis.localStorage?.setItem(STORAGE_KEY, '1');
        else globalThis.localStorage?.removeItem(STORAGE_KEY);
      } catch {
        /* storage unavailable: the toggle then lasts for this page only */
      }
    }

    /**
    * Minimal observable snapshot source in the shape the slot system's hooks
    * expect (`getSnapshot` + `subscribe`); Harness Client packages are not
    * imported by this plugin.
    * @param enabled - the persisted preference.
    * @returns the store the settings row subscribes to.
    */
    function createSnapshotStore(enabled) {
      let snapshot = { enabled, inside: false, wide: false, note: 'init' };
      const listeners = new Set();
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        update(patch) {
          let changed = false;
          for (const key of Object.keys(patch)) {
            if (!Object.is(snapshot[key], patch[key])) {
              changed = true;
              break;
            }
          }
          if (!changed) return;
          snapshot = { ...snapshot, ...patch };
          listeners.forEach((listener) => listener());
        }
      };
    }

    /**
    * Own the preference and the hover controller: the shell only exposes
    * `ctx.layout.toggleSidebar()`, so this reconciles a desired state against
    * the state the column was last *seen* in. The target is optimistic right
    * after our own toggle, which is what keeps a reversal instant: the foot's
    * `wide` flag lags the collapse by the shell's 150ms settle, and waiting on
    * it would put a dead window in front of every hover.
    * @param ctx - client root context.
    * @returns the controller face used by both registrations and its disposer.
    */
    function createController(ctx) {
      const store = createSnapshotStore(readStored());
      let enabled = store.getSnapshot().enabled;
      /** Expanded target, or null while the feature is off. */
      let desired = enabled ? false : null;
      /** The `wide` owner prop the sidebar foot hands its entries. */
      let wide = false;
      /** Where the column is or is heading: the last observed `wide`, or our own toggle's target. */
      let target = false;
      /** Whether the pointer is over the sidebar column. */
      let inside = false;
      /** Our footer anchor, the identity marker for column containment. */
      let anchor = null;
      let timer = null;
      let fireAt = Number.POSITIVE_INFINITY;

      function run() {
        if (!enabled || desired === null) {
          store.update({ note: `run:skip enabled=${String(enabled)} desired=${String(desired)}` });
          return;
        }
        if (target === desired) {
          store.update({ note: `run:match target=${String(target)}` });
          return;
        }
        store.update({ note: `run:toggle ${String(target)}→${String(desired)}` });
        target = desired;
        ctx.layout.toggleSidebar();
      }

      /** Arm the earliest deadline; later requests never postpone an armed one. */
      function schedule(delay) {
        const at = Date.now() + delay;
        if (timer !== null) {
          if (at >= fireAt) return;
          window.clearTimeout(timer);
        }
        fireAt = at;
        timer = window.setTimeout(() => {
          timer = null;
          fireAt = Number.POSITIVE_INFINITY;
          run();
        }, delay);
      }

      function setInside(next) {
        const same = inside === next;
        inside = next;
        store.update({
          inside: next,
          note: same ? `inside:unchanged ${String(next)}` : `inside→${String(next)}`
        });
        if (!enabled) return;
        desired = next;
        schedule(next ? EXPAND_DELAY_MS : COLLAPSE_DELAY_MS);
      }

      function onPointerOver(event) {
        if (!enabled) {
          store.update({ note: 'pointer:disabled' });
          return;
        }
        const target = event.target;
        if (!(target instanceof Element)) return;
        setInside(pointerInside(event, anchor));
      }

      document.addEventListener('pointerover', onPointerOver, true);

      return {
        store,
        setEnabled(next) {
          if (next === enabled) return;
          enabled = next;
          desired = next ? false : null;
          store.update({ enabled: next, note: `enabled→${String(next)}` });
          writeStored(next);
          if (next) schedule(0);
        },
        setWide(next) {
          if (wide === next) return;
          wide = next;
          target = next;
          store.update({ wide: next, note: `wide→${String(next)}` });
          if (enabled) schedule(0);
        },
        setAnchor(element) {
          anchor = element;
        },
        dispose() {
          document.removeEventListener('pointerover', onPointerOver, true);
          if (timer !== null) window.clearTimeout(timer);
          timer = null;
        }
      };
    }

    /**
    * Whether the pointer is over the sidebar column. The column is full-height
    * and pinned to the frame's left edge, so the anchor's horizontal extent IS
    * the column's hit area. A containment walk cannot decide this: the frame is
    * an ancestor of both the column and the centre, so every centre target
    * would report "inside" and the column would never collapse again. A modal
    * layered over the left edge is not a hover either.
    * @param event - the pointerover event.
    * @param anchor - the anchor rendered at the sidebar foot.
    * @returns whether the pointer counts as over the sidebar.
    */
    function pointerInside(event, anchor) {
      if (anchor === null || !anchor.isConnected) return false;
      if (insideModal(event.target)) return false;
      return event.clientX <= anchor.getBoundingClientRect().right + EDGE_TOLERANCE_PX;
    }

    /** @returns whether the pointer target sits inside an open modal dialog. */
    function insideModal(target) {
      let element = target;
      while (element !== null && element !== document.body) {
        if (element.getAttribute?.('aria-modal') === 'true') return true;
        element = element.parentElement;
      }
      return false;
    }

    /**
    * The General Settings row: title, description, and the host's switch shape.
    * @param props - selector hook over the preference plus its writer.
    * @returns the row element tree.
    */
    function SettingsRow({ t, useAutoCollapse, setEnabled }) {
      const enabled = useAutoCollapse((state) => state.enabled);
      return h('div', { className: 'ascRow' },
        h('style', null, [
          '.ascRow{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:24px;padding:16px 0;display:flex}',
          '.ascTitle{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}',
          '.ascDescription{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}',
          '.ascSwitch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}',
          '.ascSwitch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
          '.ascSwitch:disabled{cursor:default;opacity:.5}',
          '.ascSwitch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
          '.ascThumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-switch-thumb);transition:transform 120ms ease}',
          '.ascSwitch[aria-checked="true"] .ascThumb{background:var(--dsw-alias-label-primary-foreground);transform:translateX(16px)}'
        ]),
        h('div', null,
          h('div', { className: 'ascTitle' }, t('row.title')),
          h('div', { className: 'ascDescription' }, t('row.description'))),
        h('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': enabled,
          'aria-label': t('row.title'),
          className: 'ascSwitch',
          onClick: () => {
            setEnabled(!enabled);
          }
        }, h('span', { className: 'ascThumb' })));
    }

    /**
    * Zero-height anchor at the sidebar foot: it carries the live `wide` flag
    * into the controller and marks the column for pointer hit-testing, while
    * contributing no visible geometry (it is the last flex entry, so appending
    * it moves no sibling).
    * @param props - owner `wide` flag plus the controller writers.
    * @returns the anchor element.
    */
    function SidebarAnchor({ wide, setWide, setAnchor, useAutoCollapse }) {
      const state = useAutoCollapse((value) => value);
      const ref = React.useRef(null);
      React.useLayoutEffect(() => {
        setAnchor(ref.current);
        return () => {
          setAnchor(null);
        };
      }, [setAnchor]);
      React.useEffect(() => {
        setWide(wide);
      }, [wide, setWide]);
      return h('span', {
        ref,
        'aria-hidden': 'true',
        'data-asc': JSON.stringify({ ownerWide: wide, ...state }),
        style: { display: 'block', flex: '1 1 0', minWidth: 0, height: 0, overflow: 'hidden' }
      });
    }

    /** Required services (cordis fiber inject). */
    const inject = ['slots', 'locale', 'layout'];

    /**
    * Register the dictionary, the General Settings row, and the sidebar-foot
    * anchor; dispose the hover controller with the plugin.
    * @param ctx - client root context.
    */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-auto-collapse: dictionary');
      const controller = createController(ctx);
      ctx.effect(() => () => {
        controller.dispose();
      }, 'sidebar-auto-collapse: hover controller');
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'sidebar-auto-collapse',
        order: 20,
        locale: NS,
        inject: () => ({
          hooks: { autoCollapse: controller.store },
          setEnabled: (enabled) => {
            controller.setEnabled(enabled);
          }
        })
      }, SettingsRow));
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'sidebar-auto-collapse-anchor',
        order: 1000,
        locale: NS,
        inject: () => ({
          hooks: { autoCollapse: controller.store },
          setWide: (wide) => {
            controller.setWide(wide);
          },
          setAnchor: (element) => {
            controller.setAnchor(element);
          }
        })
      }, SidebarAnchor));
    }

    return { inject, apply };
  },
});
