# skins/liquid-glass —— 液态玻璃皮肤

Apple Liquid Glass 风格的 DSH Web 皮肤：流动极光环境光 + 半透明磨砂面板 + 气泡入场动画，
深浅双主题。**不碰 `node_modules`**（原方案是把 CSS 注入 `dsh-web-frontend/dist`，
`dsh plugin add/upgrade` 一冲就没了），改走 skin-center 的用户皮肤目录，升级不丢。

## 来源与授权

| 项 | 值 |
|---|---|
| 原始主题包 | 社区包 `dsh-liquid-glass-theme`（`glass.css` / `apply.js` / `README.md`），README 自陈面向前端 **0.1.0-rc.7** |
| 本仓做了什么 | **只换载体**：dist 注入 → skin-center 皮肤；样式逻辑未改 |
| 额外做了什么 | 追加「兼容补丁 v3.1」：把 18 个已换代的哈希类名按现行 DOM 改写（见下表） |
| 原作者 | 主题包 README 未署名，按社区主题对待；如需署名请开 issue 补 |

## 本机实测的类名映射（0.2.0-rc.2，2026-10-07）

核对方法：打开运行中的 3081，用 `getElementsByClassName` 逐个比对 `glass.css` 依赖的 37 个类
——**grep dist 文件会误判**（这些哈希类名不在 `dsh-web-frontend/dist/assets` 里，实测 0 命中是假阴性）。

| 旧类（主题写死） | 现行 DOM | 规则数 |
|---|---|---|
| `.pI_x6G_detailsCol` | `.pI_x6G_rightbarCol` | 2 |
| `.gdEzaW_bubble` | `.Sixlwa_bubble` | 7 |
| `.qDHVXG_searchButton` / `.qDHVXG_iconButton` | `.bhn1Oq_searchButton` / `.bhn1Oq_iconButton` | 6 |
| `.nLMEza_dock` / `_bar` / `_iconBtn` | `.uV2eYG_dock` | 9 |
| `.nL4_yW_sessionLogButton` | `.nL4_yW_moreButton` | 1 |
| 仍命中的 19 类（`frame`/三栏/`header`/`tabs`/composer card/`CY-8Ka_card`/`iWrAna_card`/`YDXeBa_sessionRow`…） | 原样 | 23 |

**未映射**：`VOzbGW_*`（设置弹层当前未挂载，要开一次设置页才知道现行类名）、
`.uV2eYG_mirror` / `.uV2eYG_backdrop`（条件渲染，规则保留为无害空转）。

## 安装 / 启用 / 卸载

```bash
# 安装（放进 skin-center 的用户皮肤目录）
mkdir -p ~/.dsh/skins/liquid-glass
cp skin.json skin.css ~/.dsh/skins/liquid-glass/

# 启用（或去 GUI：设置 → 皮肤中心 → 液态玻璃 → 应用）
# 编辑 ~/.dsh/skin-center-active.json，把 "active": null 改成 "liquid-glass"

# 卸载
# 把 active 改回 null（或在皮肤中心切别的皮肤），再 rm -rf ~/.dsh/skins/liquid-glass
```

改完强刷页面（`Ctrl+Shift+R`）。皮肤目录是**热扫描**的，通常刷新即可，不必重启 dsh-web。

## 自检

```bash
node --input-type=module -e '
const m = await import(process.env.HOME + "/.dsh/profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center/lib/index.js");
const fs = await import("node:fs");
const dir = process.env.HOME + "/.dsh/skins/liquid-glass/";
console.log("manifest:", m.validateSkinManifestV2(JSON.parse(fs.readFileSync(dir + "skin.json", "utf8"))).ok);
console.log("css:", m.transformSkinCss(fs.readFileSync(dir + "skin.css", "utf8"), "liquid-glass").code.length, "bytes");'
```

## 微调

- 极光亮度/颜色/速度：`skin.css` 里 `body[data-ds-dark-theme]::after` 一族的 `radial-gradient(...)` 与 `dsh-glass-drift-a/b` 时长
- 玻璃感：各表面的 `background` / `border` / `box-shadow` 透明度
- 只想留背景、不要组件玻璃：删掉 `兼容补丁 v3.1` 之后的段落即可

相关：根目录 `docs/CHANGES.md` 第 9 节记录了这次改造的动机与验证。
