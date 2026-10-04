/**
 * Node smoke test for the client half: no browser, no Harness. Stubs the
 * module loader, React, document and ctx, then runs the real apply(), the real
 * registrations, and the real hover state machine against fake DOM nodes.
 *
 *   node test/selftest.mjs
 */

let captured;
const documentListeners = new Map();

class FakeEl {
  constructor(name, parent = null) {
    this.name = name;
    this.parentElement = parent;
    this.isConnected = true;
  }
  contains(node) {
    for (let el = node; el !== null; el = el.parentElement) if (el === this) return true;
    return false;
  }
  getBoundingClientRect() {
    return { left: 10, right: 46, top: 0, bottom: 800 };
  }
}

const html = new FakeEl('html');
const body = new FakeEl('body', html);
const column = new FakeEl('column', body);
const anchorNode = new FakeEl('anchor', column);
const insideTarget = new FakeEl('row', column);
const outsideTarget = new FakeEl('main', body);

globalThis.window = {
  __ModuleLoader__: { load: (definition) => { captured = definition; } },
  setTimeout,
  clearTimeout,
};
globalThis.document = {
  body,
  documentElement: html,
  addEventListener(type, listener) { documentListeners.set(type, listener); },
  removeEventListener(type, listener) { if (documentListeners.get(type) === listener) documentListeners.delete(type); },
};
globalThis.Element = FakeEl;

const cleanups = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useRef: (initial) => ({ current: initial === null || initial === undefined ? anchorNode : initial }),
  useEffect: (effect) => { const dispose = effect(); if (typeof dispose === 'function') cleanups.push(dispose); },
  useLayoutEffect: (effect) => { const dispose = effect(); if (typeof dispose === 'function') cleanups.push(dispose); },
};

await import('../client.js');
if (!captured) throw new Error('module did not register with __ModuleLoader__');
if (captured.id !== '@local/sidebar-auto-collapse') throw new Error(`unexpected id ${captured.id}`);
const plugin = captured.factory((specifier) => {
  if (specifier === 'react') return React;
  throw new Error(`unexpected require: ${specifier}`);
});

const failures = [];
const check = (condition, label) => {
  if (condition) console.log(`  ok   ${label}`);
  else { failures.push(label); console.log(`  FAIL ${label}`); }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const localeCalls = [];
const injects = [];
const registrations = [];
let toggles = 0;
const ctx = {
  effect(effect) { const dispose = effect(); if (typeof dispose === 'function') cleanups.push(dispose); return () => {}; },
  locale: { register(ns, dicts) { localeCalls.push({ ns, dicts }); return () => {}; } },
  slots: {
    inject(key, callback) { injects.push({ key, callback }); return () => {}; },
    register(options, component) { registrations.push({ options, component }); return () => {}; },
  },
  layout: { toggleSidebar() { toggles += 1; } },
};

console.log('apply');
plugin.apply(ctx);
check(JSON.stringify(plugin.inject) === JSON.stringify(['slots', 'locale', 'layout']), 'inject lists slots/locale/layout');
check(localeCalls.length === 1 && localeCalls[0].ns === 'sidebarAutoCollapse', 'dictionary registered under our namespace');
check(localeCalls[0].dicts.zh['row.title'].length > 0 && localeCalls[0].dicts.en['row.title'].length > 0, 'zh and en dictionaries present');

injects.forEach((entry) => entry.callback());
check(injects.map((entry) => entry.key).join(',') === 'settings.general.item,sidebar.footer.action', 'both seats injected');
const row = registrations.find((entry) => entry.options.name === 'settings.general.item');
const anchor = registrations.find((entry) => entry.options.name === 'sidebar.footer.action');
check(row !== undefined && row.options.id === 'sidebar-auto-collapse' && row.options.order === 20, 'settings row registration (id, order)');
check(anchor !== undefined && anchor.options.id === 'sidebar-auto-collapse-anchor', 'sidebar foot anchor registration');

const rowFace = row.options.inject();
const anchorFace = anchor.options.inject();
check(typeof rowFace.hooks.autoCollapse.getSnapshot === 'function', 'hook source is an observable snapshot');
check(rowFace.hooks.autoCollapse.getSnapshot().enabled === false, 'preference starts off');

console.log('mount');
const anchorEl = anchor.component({ wide: true, ...anchorFace });
check(anchorEl.type === 'span', 'anchor renders a span');
const rowEl = row.component({
  t: (key) => key,
  useAutoCollapse: (selector) => selector(rowFace.hooks.autoCollapse.getSnapshot()),
  setEnabled: rowFace.setEnabled,
});
const toggle = rowEl.children.find((child) => child.props.role === 'switch');
check(toggle !== undefined && toggle.props['aria-checked'] === false, 'switch renders off');
check(rowEl.children[1].children[0].children[0] === 'row.title', 'title text resolves through the locale seat');

console.log('enable collapses the column');
rowFace.setEnabled(true);
await sleep(60);
check(toggles === 1, 'exactly one toggleSidebar after enabling');
check(rowFace.hooks.autoCollapse.getSnapshot().enabled === true, 'preference published to the row');
anchorFace.setWide(false);
await sleep(60);
check(toggles === 1, 'no toggle inside the settle window');
await sleep(500);
check(toggles === 1, 'no toggle once the column already matches');

console.log('hover expands, leaving collapses');
documentListeners.get('pointerover')({ target: insideTarget, clientX: 200 });
await sleep(60);
check(toggles === 2, 'hover-in toggles the column back open');
anchorFace.setWide(true);
await sleep(500);
check(toggles === 2, 'no toggle while the pointer stays inside');
documentListeners.get('pointerover')({ target: outsideTarget, clientX: 600 });
await sleep(260);
check(toggles === 3, 'hover-out toggles the column closed');
anchorFace.setWide(false);
await sleep(500);
check(toggles === 3, 'stable after hover-out settle');

console.log('disable stops the controller');
rowFace.setEnabled(false);
documentListeners.get('pointerover')({ target: insideTarget, clientX: 200 });
await sleep(300);
check(toggles === 3, 'no toggles while the feature is off');
check(documentListeners.has('pointerover'), 'pointer listener still installed until dispose');

cleanups.forEach((dispose) => dispose());
check(!documentListeners.has('pointerover'), 'pointer listener removed on dispose');

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} failure(s)`);
  process.exit(1);
}
console.log('\nall checks passed');
