#!/usr/bin/env bash
# 冒烟验收：apply + 重启之后跑，逐项 ✅/❌。PUBLIC=1 时额外探公网域名。
# 用法：./verify.sh  |  PUBLIC=1 ./verify.sh
set -uo pipefail
DSH_HOME=${DSH_HOME:-$HOME/.dsh}
DSH_PROFILE=${DSH_PROFILE:-web}
NM="$DSH_HOME/profiles/$DSH_PROFILE/node_modules"
FAIL=0
ok()   { printf '✅ %s\n' "$*"; }
err()  { printf '❌ %s\n' "$*"; FAIL=1; }

echo "== 1) host 存活 + 新码装载（restart-dsh/status 探活 + 服务启动时间）"
S=$(curl -s --max-time 3 http://127.0.0.1:3081/restart-dsh/status || true)
if echo "$S" | grep -q '"ok":true'; then
  ok "status: $S"
else
  err "服务无响应：${S:-（无响应）} → systemctl status dsh-web"
fi
if systemctl is-active -q dsh-web 2>/dev/null; then
  START=$(systemctl show dsh-web -p ExecMainStartTimestamp --value)
  ok "dsh-web active（启动于 $START）——node_modules 的改动要晚于该时间才算已装载"
else
  err "dsh-web 未运行"
fi

echo "== 2) 探活路由 HTTP 码"
# 旧 /dsh-health、/dsh-watch 属已卸载的 dsh-web-restart；现役 better-dsh-web-restart
# 只暴露 /restart-dsh/{status,arm,cancel}（见其 README「HTTP API」表）。
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 'http://127.0.0.1:3081/restart-dsh/status' || echo 000)
[ "$C" = 200 ] && ok "HTTP 200" || err "HTTP $C（期望 200）"

echo "== 3) dsh-pocket 两处补丁"
P="$NM/dsh-pocket/lib/index.js"
if grep -q 'loadOrCreateSessionKey' "$P" 2>/dev/null && grep -q 'process.env.DSH_HOME ?? join(homedir()' "$P" 2>/dev/null; then
  ok "sessionKey 落盘 + home 兜底都在"
else
  err "补丁缺失 → ./apply.sh 后重启"
fi

echo "== 4) sessionKey 文件权限（600）"
K="$DSH_HOME/dsh-pocket/session.key"
if [ -f "$K" ]; then
  M=$(stat -c '%a' "$K")
  [ "$M" = 600 ] && ok "600" || err "权限 $M（期望 600）→ chmod 600 $K"
else
  err "缺失（下次启动会自动生成）"
fi

echo "== 5) 预算闸 hook（v3 换皮判重）"
if grep -q 'dsh-budget-.*\.skels' "$HOME/.claude/hooks/tool-budget.sh" 2>/dev/null; then
  ok "tool-budget.sh v3"
else
  err "hook 是旧版 → ./apply.sh"
fi

echo "== 6) 自研插件文件在位"
HERE_PLUG=$(cd "$(dirname "$0")" && pwd)
for p in dsh-monitor sidebar-auto-collapse panel-drawer; do
  if [ -f "$HERE_PLUG/plugins/$p/package.json" ]; then ok "plugins/$p"; else err "仓库缺 plugins/$p"; fi
done

echo "== 7) Token 银行 mimo 铸造判定（0.4.6 起上游合入，检测代替打补丁）"
T="$NM/@linxin666/dsh-web-all/lib/client.js"
if grep -q 'EXTRA_MINT_ROUTE_IDS' "$T" 2>/dev/null; then
  ok "dsh-web-all 含 mimo 铸造判定（上游 0.4.6 实现，聚合包是真被加载的那份）"
elif grep -q 'row.provider === "mimo"' "$T" 2>/dev/null; then
  ok "dsh-web-all 含 mimo 铸造判定（本机 0.4.5 补丁）"
else
  err "mimo 铸造判定缺失 → ./apply.sh 后重启（只改 dsh-usage 无效，client 内联在聚合包里）"
fi
echo "== 7b) meow-memory 反思轮折叠修复（上游 PR #47 未合入，靠重放）"
if grep -q 'node.kind !== "context" && node.kind !== "turn-trigger"' "$NM/meow-memory/lib/client.js" 2>/dev/null; then
  ok "isMemoryPrompt 认 turn-trigger"
else
  err "折叠锚点修复缺失 → ~/test_mimo/meow-memory-fold-fix/apply.sh（prepare 重建必冲掉它）"
fi

if [ "${PUBLIC:-0}" = "1" ]; then
  echo "== 8) 公网隧道"
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://dsh.hack4fun.asia/ || echo 000)
  case "$C" in
    200|401|302) ok "HTTP $C" ;;
    530|502|503) err "HTTP $C → 隧道没起：journalctl -u dsh-web | grep pocket" ;;
    *) err "HTTP $C" ;;
  esac
fi

echo
[ "$FAIL" -eq 0 ] && echo "ALL PASS（状态 done）" || { echo "HAS FAIL（状态 needs-verification）"; exit 1; }
