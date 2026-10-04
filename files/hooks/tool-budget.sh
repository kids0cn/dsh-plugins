#!/bin/bash
# Global PostToolUse hook（matcher: bash）—— 调研预算闸 v3
#
# v1（2026-10-04 上午）：总量计数，60/150/300/500 注入提醒。起因与判据见
#   HARNESS.md「调研类任务的预算闸」（832 次调用 / 178 分钟 / 零产出）。
# v2（2026-10-04 晚，用户拍板两个改法）——修正 v1 会误伤长任务的问题：
#   ① 只计重复：按命令哈希去重，同一命令第 2 次起才占预算，独特命令免费。
#      长任务跑 60+ 条不同命令是正常工程，不该触发"发散到此为止"。
#      权衡：误伤一次 = 提前转写，一句话能救；不设闸 = 重演报废会话。
#   ② 落盘回血：matcher write|edit 走本脚本 `reset` 子命令，一写文件就清零。
#      语义：预算限的是「查了不写」，产出即回血 —— 只要任务在推进，永不误伤。
# v3（2026-10-04 20:50，用户拍板）——堵 v2 的字面逃逸：
#   ③ 换皮也算重复：算两个哈希，精确哈希之外再算一个**语义骨架**哈希
#      （heredoc 正文 → <<HD>>、引号内字面量 → S、数字 → N、压空白）。
#      `grep "重启dsh" 目录` 换成 `grep "restart dsh" 同目录`、heredoc 换段正文、
#      路径不变只改参数 —— 字面全不同、语义是同一件事 → 计 1 次换皮重复。
#      诱因：2026-10-04 20:20 会话 51 条 bash 字面全唯一、预算闸只记 6 次，
#      实际同一件事翻了 18 分钟（LLM 思考占 15.6min）—— 字面唯一 ≠ 没在兜圈。
#      反向保护：无引号的路径/命令行不抹（`ls a` vs `ls b` 仍算两条）；
#      骨架短于 6 字符不算（防全部塌缩成同一个哈希）。
# 分档（60/150/300/500）与「每档只提醒一次」不变；reset 只清计数、
# 不清 .warned 标记（同档不重复唠叨，升档仍逐级变硬）。
# 仍是「只读计数 + 只注入提示」：不写工作区、不碰 git（避开 hook 自反馈循环）。
#
# 用法：tool-budget.sh            ← PostToolUse(bash) 计数并注入
#       tool-budget.sh reset      ← PostToolUse(write|edit) 落盘回血
#
# 计数/哈希文件放 /tmp（按 session_id 隔离），绝不进仓库；7 天自清理。

INPUT=$(cat)

SID=$(printf '%s' "$INPUT" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -z "$SID" ] && exit 0

CNT_FILE="/tmp/dsh-budget-${SID}.log"        # 重复命令计数（预算，精确+换皮）
SEM_FILE="/tmp/dsh-budget-${SID}.sem"        # 其中换皮重复的计数
HASH_FILE="/tmp/dsh-budget-${SID}.hashs"     # 本会话见过的精确哈希（去重表）
SKEL_FILE="/tmp/dsh-budget-${SID}.skels"     # 本会话见过的语义骨架哈希（去重表）
WARNED_DIR="/tmp/dsh-budget-${SID}.warned"   # 已提醒过的档位

# 落盘回血：清预算计数，保留去重表与已提醒档位
if [ "${1:-}" = "reset" ]; then
    rm -f "$CNT_FILE" "$SEM_FILE" 2>/dev/null
    exit 0
fi

find /tmp -maxdepth 1 \( -name 'dsh-budget-*.log' -o -name 'dsh-budget-*.sem' \
    -o -name 'dsh-budget-*.hashs' -o -name 'dsh-budget-*.skels' -o -name 'dsh-budget-*.warned' \) \
    -mtime +7 -delete 2>/dev/null

mkdir -p "$WARNED_DIR" 2>/dev/null || exit 0

# 取 tool_input.command → 输出 "<精确哈希> <语义骨架哈希>"（骨架过短则第二列为空）
# 代码经 heredoc 传给 python：正则里有单引号，塞不进 bash 的 -c '...'。
PYCODE=$(cat <<'PY'
import hashlib, json, re, sys
cmd = ""
try:
    cmd = json.load(sys.stdin).get("tool_input", {}).get("command") or ""
except Exception:
    pass
if not cmd.strip():
    sys.exit(0)
exact = re.sub(r"\s+", " ", cmd).strip()
# 语义骨架：heredoc 正文整段抹掉 → 再抹引号内字面量 → 再抹数字 → 压空白
sem = re.sub(r"<<-?\s*['\"]?(\w+)['\"]?[^\n]*\n(?:.*?\n)?\s*\1\b", "<<HD>>", exact, flags=re.S)

# 引号内字面量抹成 S（grep 关键词、curl payload 这类"换词即换皮"的变量）；
# 但看起来像路径的保留 —— `cat "a.txt"` vs `cat "b.txt"` 是两件事，不算重复。
def _lit(m):
    body = m.group(0)[1:-1]
    return m.group(0) if re.search(r"[/~$]", body) else "S"
sem = re.sub(r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"", _lit, sem)
sem = re.sub(r"\d+", "N", sem)
sem = re.sub(r"\s+", " ", sem).strip()
h = hashlib.sha1(exact.encode()).hexdigest()
k = hashlib.sha1(sem.encode()).hexdigest() if len(sem) >= 6 else ""
print(h + " " + k)
PY
)

PAIR=$(printf '%s' "$INPUT" | python3 -c "$PYCODE")
[ -n "$PAIR" ] || exit 0                       # 解析失败不计数，不消耗预算
H=${PAIR%% *}
S=${PAIR##* }
[ -n "$H" ] || exit 0

# 判重：先查精确哈希；不中再查语义骨架（换皮）。都不中 = 首见，免费。
KIND=""
if [ -f "$HASH_FILE" ] && grep -qxF "$H" "$HASH_FILE" 2>/dev/null; then
    KIND=exact
elif [ -n "$S" ] && [ -f "$SKEL_FILE" ] && grep -qxF "$S" "$SKEL_FILE" 2>/dev/null; then
    KIND=sem
fi

if [ -z "$KIND" ]; then
    printf '%s\n' "$H" >> "$HASH_FILE" 2>/dev/null || exit 0
    [ -n "$S" ] && printf '%s\n' "$S" >> "$SKEL_FILE" 2>/dev/null
    exit 0                                      # 首见命令：免费，静默退出（计数文件还没建，别去 wc）
fi

# 重复：记下这个精确变体（换皮分支里它是新的），并占预算
if [ "$KIND" = "sem" ]; then
    printf '%s\n' "$H" >> "$HASH_FILE" 2>/dev/null
    # O_APPEND 单行追加是原子的 —— 每步并行 2 个 bash 也不会丢计数
    echo x >> "$SEM_FILE" 2>/dev/null
fi
echo x >> "$CNT_FILE" 2>/dev/null || exit 0

# 注意 2>/dev/null 必须排在 < 之前：重定向按左到右执行，
# `< 缺失文件` 会先把报错打到终端（M=0 已兜底，别让它刷屏）。
N=$(wc -l 2>/dev/null < "$CNT_FILE")
N=${N:-0}
M=$(wc -l 2>/dev/null < "$SEM_FILE")
M=${M:-0}
[ "$N" -gt 0 ] || exit 0                       # 本会话还没有重复命令 → 静默

# 分档提醒：够用就闭嘴（无输出 = 零 token 成本）
WARN=""
if   [ "$N" -ge 500 ]; then LEVEL=500
elif [ "$N" -ge 300 ]; then LEVEL=300
elif [ "$N" -ge 150 ]; then LEVEL=150
elif [ "$N" -ge 60  ]; then LEVEL=60
else exit 0
fi

# 每档只提醒一次
[ -e "$WARNED_DIR/$LEVEL" ] && exit 0
touch "$WARNED_DIR/$LEVEL" 2>/dev/null || exit 0

SEMNOTE=""
[ "$M" -gt 0 ] && SEMNOTE="其中换皮重复 ${M} 次（同命令改关键词/参数/换 heredoc 正文 —— 字面不同、事是同一件，不算新调查）。"

case "$LEVEL" in
  60)  WARN="【调研预算 · 第 1 档 · 重复累计 ${N} 次】发散阶段到此为止。现在就把已有材料写成文档骨架落盘（写文件即回血、计数清零），之后**只补缺的那一项**——不要为了「再确认一下」重跑已跑过的命令、重查同一个文件。同一接口取 1 次样即可复用；大文件整读一次即可，别反复 grep。${SEMNOTE}" ;;
  150) WARN="【调研预算 · 第 2 档 · 重复累计 ${N} 次】超支。**立即停止调研，开写正文**：一次 write 把文档主体写出去（落盘即回血），边写边发现的缺口再单点查。已重复过的命令一条都不许再跑（本次会话已出现同一命令跑 45 次的先例）。${SEMNOTE}" ;;
  300) WARN="【调研预算 · 第 3 档 · 重复累计 ${N} 次】严重超支 —— 参照案例（832 次调用 / 178 分钟 / 零产出）。**唯一正确的动作：现在就写文件**。禁止再发起任何探索性 grep/curl，只允许为写入当前章节做单次确认。${SEMNOTE}" ;;
  500) WARN="【调研预算 · 第 4 档 · 重复累计 ${N} 次】极端超支。你正在重演一次失败会话。**立刻 write 落盘当前成果并收尾**，不要再验证任何结论。${SEMNOTE}" ;;
esac

printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}' "$WARN"
exit 0
