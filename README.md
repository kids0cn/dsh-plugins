# dsh-plugins

我对 **DeepSeek Harness（dsh）** 的本地改动 + 自研插件，公开仓库，**按文件夹组织**。

> 为什么单独立仓库：这些改动都活在 `node_modules/` 里，**任何 `dsh plugin add/upgrade`、
> pnpm 重装都会把它们冲掉**。这里存快照 + 补丁 + 重放脚本，升级后跑一遍就回来。

## 目录约定（新东西往哪放）

| 目录 | 放什么 | 例子 |
|---|---|---|
| `plugins/<name>/` | ⭐ **自研插件**（以后每个新插件一个文件夹，自带 `package.json` + `cordis.patch.yml` + README） | `dsh-monitor`、`sidebar-auto-collapse`、`panel-drawer` |
| `forks/<name>/` | 对上游**整包**的 fork 快照（改动集中、量大） | （暂空：`dsh-web-restart` 已删，重写中） |
| `patches/<pkg>-<ver>/` | 对上游包的**局部补丁**（unified diff + 原版版本号） | `dsh-pocket-2.10.6` |
| `files/` | 不属于某个包的独立文件 | `hooks/tool-budget.sh`、`profile/*` |
| `docs/CHANGES.md` | 每处改动的动机 / 验证 / 上游 issue | — |

**绝不见库**：`session.key`、PIN（`token`/`token-lan`）、`web.env`、`.credentials.yaml`
（见 `.gitignore`）。仓库里只有代码与配置，**零密钥**。

## 升级 / 重装后怎么恢复

```bash
git clone https://github.com/kids0cn/dsh-plugins.git
cd dsh-plugins
./apply.sh      # 幂等重放：pocket 打补丁 + hook 安装（+ --with-profile 拷 profile）
sudo systemctl restart dsh-web   # HMR 不看源码（root: []），不重启不生效
./verify.sh     # 冒烟：health 探针 / 补丁标记 / session.key 权限 / journal 信标
```

两类改动在升级时的命运：

| 类型 | 升级会怎样 | `apply.sh` 怎么处理 |
|---|---|---|
| 局部补丁 | pnpm 升级还原原文件 | 检测是否已打过 → `patch -p1 --forward`；版本变了会明确报错，不静默 |
| 独立文件 | 不受影响（不在 node_modules） | 直接安装（hook 先备份旧文件） |

## 新增一个自研插件

1. 建 `plugins/<name>/`：至少 `package.json`（含 `dsh.bundle.patch` / `dsh.client` 字段）、
   `cordis.patch.yml`、`lib/index.js`（host 半边）、`lib/client.js`（client 半边）、`README.md`
2. 本机安装并验证：
   ```bash
   dsh plugin --profile web add /绝对路径/dsh-plugins/plugins/<name>
   sudo systemctl restart dsh-web      # 装载
   curl -s localhost:3081/dsh-health    # 看探针
   ```
3. 提交：`git add plugins/<name> && git commit -m "add <name>"`
4. 需要"改了什么/为什么"就在 `docs/CHANGES.md` 加一行

## 内容清单

| 路径 | 是什么 | 来源 |
|---|---|---|
| `patches/dsh-pocket-2.10.6` | ① `home` 兜底（隧道自动恢复死码）② `sessionKey` 落盘（重启免重输 PIN） | npm `dsh-pocket@2.10.6` |
| `plugins/dsh-monitor` | 侧边栏监视面板：后台任务 / 会话 / 系统负载 | 自研 |
| `plugins/sidebar-auto-collapse` | 侧边栏自动折叠 + 悬停展开（设置页「自动收起左侧栏」开关，含 27 项自测） | 自研 |
| `plugins/panel-drawer` | 左侧栏二级抽屉：面板入口收进一个图标（技能中心/任务看板/上下文洞察默认收编），管理页拖动选择显隐，中英双语 | 自研 |
| `files/hooks/tool-budget.sh` | 调研预算闸（重复 + **换皮重复**判重，60/150/300/500 分档提醒） | 自研 |
| `files/profile/` | web profile 的 `cordis.patch.yml` + `package.json`（hooks 桥接 / llm-mimo / 默认模型 / 本地 bundle 依赖） | 本机配置快照 |

动机、验证记录、上游 issue 链接 → **[docs/CHANGES.md](docs/CHANGES.md)**。

## 许可

- `patches/dsh-pocket-2.10.6/` —— 上游 `dsh-pocket` 为 **GPL-2.0**；本目录是针对它的 diff
  （衍生作品，**同以 GPL-2.0 发布**；原包本身不在本仓库再分发，见该目录 `LICENSE-NOTE`）
- 其余（`plugins/`、`files/`、脚本、文档）—— 原创，**MIT**
