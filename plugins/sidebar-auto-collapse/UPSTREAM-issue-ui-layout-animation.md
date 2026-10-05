# Upstream report — sidebar toggle never runs its CSS transition (ui-layout)

**Repo**: `deepseek-ai/deepseek-harness` (`apps/cli` + `packages/client/ui-layout`)
**Component**: `packages/client/ui-layout` → `AppFrame` (frame grid, `[data-animating]`)
**DSH version**: 0.2.0-rc.2 (web profile, `dsh web --port 3081`)
**Found by**: plugin `@local/sidebar-auto-collapse` (settings toggle + hover-to-expand for the left sidebar), which drives `ctx.layout.toggleSidebar()` from Client code.

---

## TL;DR（给中文读者）

左栏收起/展开的 300ms 缓动**从来没有生效过**：宿主自己的"收起侧边栏"按钮也是一帧切过去的。
原因是在同一次 React 提交里既改了 `grid-template-columns` 又加了 `data-animating`，
而 transition 规则挂在 `[data-animating]` 上，所以**首次变化时 transition 还没生效**；
只有 600ms 窗口内的**第二次**变化（标志已存在）才真的插值。

---

## Symptom

Toggling the left sidebar (host's own "Collapse sidebar" / "Open sidebar" button, `⌘/Ctrl+B`,
or `ctx.layout.toggleSidebar()` from a plugin) changes the frame's
`grid-template-columns` in a single frame. No easing is visible — the column snaps.

## Measurements

Sampling `getComputedStyle(frame).gridTemplateColumns` every 15–30 ms
(`prefers-reduced-motion: reduce` → **false**, `--ds-transition-duration-slow` → **`.3s`**,
`--ds-ease-in-out` → **`cubic-bezier(.4, 0, .2, 1)`**):

| Case | Samples (sidebar track) | Result |
|---|---|---|
| Host button → collapse | `280px` ×5 → `56px*` ×many | **snap, no interpolation** |
| Host button → expand | `56px` ×5 → `280px*` ×many | **snap, no interpolation** |
| Plugin `toggleSidebar()` → collapse | `280px` ×11 → `56px*` ×19 | **snap, no interpolation** |
| Second change *inside* the animating window | `56px*` → `57.609 → 63.34 → 75.05 → 95.22 → 124.78 → … → 279.609` | **eased over ~300 ms** ✓ |

`*` = `data-animating` present on that sample.

So the transition *is* wired up correctly — it only ever starts when the attribute
was **already** present before the value changed.

## Root cause (analysis, not yet confirmed by a fix)

`AppFrame` (client bundle `dsh-client-ui-layout/lib/client.js`) does:

```js
// render: the frame's inline style carries the new tracks
style={{ gridTemplateColumns: `${cols.sidebar}px …` }}
data-animating={animating > 0 || undefined}

// after commit:
useLayoutEffect(() => {
  if (previousToggle.current === trackToggle) return;
  previousToggle.current = trackToggle;
  if (viewportChanged) return;
  setAnimating(token => token + 1);      // ← attribute lands in a second commit
}, [trackToggle, viewport]);
```

with the rule

```css
.pI_x6G_frame[data-animating] { transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
```

Empirically the transition is not in effect for the style-change event that carries the
new `grid-template-columns`, so Chrome starts no transition; the attribute only helps the
*next* change (which is exactly the "second change interpolates" row above).
The 600 ms settle timer then keeps `data-animating` around, making the behaviour look random.

## Suggested fixes (either would do)

1. **Always-on transition, opt out where the host already opts out**
   ```css
   .pI_x6G_frame { transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out); }
   .pI_x6G_frame[data-dragging] { transition: none; }
   @media (prefers-reduced-motion: reduce) { .pI_x6G_frame { transition: none; } }
   ```
   `data-animating` then only has to gate the *content crossfade*, not the track easing.

2. **Pre-arm the attribute** — set `data-animating` (or a permanent transition) in the same
   commit *before* the track value changes, e.g. derive it from the pending target rather
   than from a follow-up state update.

Option 1 is the smaller change and matches what the `data-dragging` / `prefers-reduced-motion`
rules already express.

## Impact

- The sidebar visibly snaps for every user-facing toggle.
- Plugins that drive `ctx.layout.toggleSidebar()` (hover-to-expand, auto-collapse, …) inherit
  the snap and cannot compensate: the frame element and its styles are host-owned, and a
  consumer-side stylesheet override would have to out-specify `[data-dragging]` and the
  reduced-motion media query — i.e. fix the wrong layer.

## Environment / how to reproduce

1. `dsh web` (0.2.0-rc.2), open the page in Chromium, OS reduced-motion **off**.
2. In DevTools console:
   ```js
   const el = document.querySelector('[style*="grid-template-columns"]');
   setInterval(() => console.log(getComputedStyle(el).gridTemplateColumns.split(' ')[0],
                                 el.hasAttribute('data-animating')), 15);
   ```
3. Click **Collapse sidebar** in the sidebar foot (or press `⌘/Ctrl+B`).
4. Observe: the first value printed after the click is already `56px`; no intermediate values.
5. Click again within ~600 ms: now intermediate values *do* appear (the transition runs).
