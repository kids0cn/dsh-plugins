# meow-memory 0.29.0 本地补丁 —— 折叠横条复活（dsh 0.2.0-rc.2 契约适配）

**目标文件**：`<profile>/node_modules/meow-memory/lib/client.js`
**应用方式**：`patch -d $NM/meow-memory -p1 --forward < meow-memory-0.29.0.patch`（apply.sh 第 5 步已接）

## 背景（2026-10-12 诊断）
上游 CHANGELOG 自证：`conversation.composer.dock` 的 props 契约已变过两次
（`{session:.chat}` → dsh 0.1.5 `{useChat,t}`，v0.26.0 跟随修复）。现装 dsh 0.2.0-rc.2 的渲染点
`renderSlot("conversation.composer.dock", {})` 只传空对象，且该槽位宿主的 standard kit 未合并 →
dock 拿不到 `useChat`/`session` 座位 → `snapshot = undefined` → `computeFoldGroups/computeInjectionGroups`
首行 `if (snapshot?.chat === void 0) return []` **静默**返回空 → 四套横条全部不出现（无任何报错/warn）。

探针实证：`data-meow-memory-anchor`=0、`[data-chat-flow]`=31、`data-meow-vanish` 存在（slots 与另一 dock 正常）。

## 补丁做了什么
1. **多候选槽位注册**：`conversation.composer.dock`（现空 props）之外，追加
   `conversation.session.header.actions`（本插件 vanish dock 的 `useSessions` 在此实证可用）、
   `conversation.input.overlay`。三个槽位均为 `kind: "list"`，不会替换出厂组件。
2. **单实例仲裁**：模块级 `foldDockClaim`，第一个真正拿到座位的实例独占执行折叠 DOM 逻辑；
   无座位实例全部空转（不会清掉有座位实例插入的锚点，也不会互相打架）。
3. `MemoryFoldDock` 自身 `return null`，多槽位注册零视觉副作用。

## 上游
已提 issue：https://github.com/Phant0Meow/dsh-meow-memory/issues/53
上游修好后本补丁应删除（apply.sh 检测 `foldDockClaim` 存活；升级后人工核对一次即可）。

## 回滚
`patch -R -d $NM/meow-memory -p1 < meow-memory-0.29.0.patch`，或用 `upstream-lib-client.js.orig` 覆盖。
