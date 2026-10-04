# 本地 fork（上游：github:1123762794/dsh-web-restart，main 5de8214）

只改了 `lib/index.js` 和 `lib/client.js`，其余与上游一致。改动动机与验证见 `../../docs/CHANGES.md`。
上游 issue：https://github.com/1123762794/dsh-web-restart/issues/2

**为什么不用 fork 而存快照**（2026-10-04 用户拍板）：不建 GitHub fork，升级时
`dsh plugin add` 装回上游 → 再跑 `../../apply.sh` 把这两个文件覆盖回去。
