# dsh-cc-hooks

Claude Code hooks 的 **DSH 原生迁移**（2026-10-07 用户拍板：不走 `dsh-hooks-claude-code` 桥）。

## 为什么

桥的 PostToolUse matcher 是字面大小写匹配，settings.json 的 `Write|Edit` 对不上 DSH 小写
工具名 `write|edit` → `post-edit-commit.sh` 在 DSH 下**静默失效**（2026-10-07 读源码实锤）。
桥的复用价值在「分开维护配置」后消失，且 PostToolUse/Stop 执行路径从未真正跑通过 ——
正确性关键的兜底 hook 全部迁原生，触发时机自己说了算，执行体仍是原来那份 bash（单一事实源）。

## 迁移对照

| Claude hook | DSH 原生触发点 | 执行体（复用不改） |
|---|---|---|
| SessionStart | `agent/pre-step` step===1，每 session 一次，await 先于首次请求 | `task-start-snapshot.sh capture`（⚠️ Claude 侧从未接线，本次补上）+ `hermes-context.js` |
| PostToolUse `Write\|Edit` | `tools/post-execute` name∈{write,edit}，阻塞等完成 | `post-edit-commit.sh`（stdin `{session_id, cwd}`） |
| Stop | `turn/end`（每回合结束，等价 Claude Stop） | `stop-commit.sh` |

## 命名日志（本插件的附加要求）

别的功能要统计实时 hook，所以每次执行写两路：

1. **会话事件流**（实时）：`session.append("hook/invoked"/"hook/result")`，与桥同事件名同形状，
   但 `handlerId` 是**真实脚本名**（`post-edit-commit.sh`）而非序号 → 统计可聚合到
   「post-edit-commit ×3」粒度。
2. **文件兜底**：`~/.dsh/hooks-stats.jsonl` 每行一条 JSON：
   `{ts, sessionId, point, handler, decision, exitCode?, ms, stderr?}`，
   开机先写一条 `point:"plugin/apply"` 信标（验证插件是否装载）。
   dsh-guards 的两闸提醒也写同一个文件（handler `dsh-guards.budget` / `dsh-guards.turn`）。

## 已知缺口

- **compact 后索引不重注**：等价物只覆盖 Claude matcher 的 startup/resume（进程重启 = Set 清空
  = 自然重注入）；compact/fork 不触发（事件面上没有对应点，暂缺）。
- `turn/end` 的 payload 形状未实证：agent 引用靠 `payload.agent ?? lastAgent` 兜底；
  若事件名对不上，Stop 会静默不触发 —— **重启后必须验证**（见下）。
- stop-commit 的 stdout（📦 提交回执 / 📊 日报）不回显到会话，结果看 git log。

## 安装 / 验证

```bash
dsh plugin --profile web add /home/developer/test_mimo/dsh-plugins/plugins/dsh-cc-hooks
sudo systemctl restart dsh-web
# 装载信标：
tail -1 ~/.dsh/hooks-stats.jsonl        # 期望 point:"plugin/apply"
# 编辑后 git add：
echo x >> 文档/项目状态.md && sleep 2 && git status --short | head -3   # 期望第一列 M
# 索引注入：新开会话首条应有 [Hermes 共享记忆索引]
# Stop：回合结束后 git log 应出现「会话结束自动提交」（有未提交变更时）
```
