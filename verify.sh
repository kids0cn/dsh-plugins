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

echo "== 1) host 装载探针（/dsh-health 应含 version/branch/pid）"
H=$(curl -s --max-time 3 http://127.0.0.1:3081/dsh-health || true)
if echo "$H" | grep -q '"version":"wsl-'; then
  ok "$H"
else
  err "health 异常或未装载新码：${H:-（无响应）} → 没重启？sudo systemctl restart dsh-web"
fi

echo "== 2) 信标路由 /dsh-watch（client 看门狗靠它进 journal）"
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 'http://127.0.0.1:3081/dsh-watch?e=verify' || echo 000)
[ "$C" = 204 ] && ok "HTTP 204" || err "HTTP $C（期望 204）"

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

echo "== 7) Token 银行 mimo 铸造补丁"
if grep -q 'row.provider === "mimo"' "$NM/@linxin666/dsh-web-all/lib/client.js" 2>/dev/null; then
  ok "dsh-web-all client 含 mimo 铸造判定（聚合包是真被加载的那份）"
else
  err "补丁缺失 → ./apply.sh 后重启（只改 dsh-usage 无效，client 内联在聚合包里）"
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
