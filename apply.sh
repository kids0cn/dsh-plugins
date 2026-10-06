#!/usr/bin/env bash
# 幂等重放本仓库的本地改动 —— 升级/重装 dsh 插件后跑一次。
# 用法：./apply.sh [--with-profile]
#   --with-profile  同时把 files/profile/cordis.patch.yml 拷进 profile（会覆盖本机同名文件）
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DSH_HOME=${DSH_HOME:-$HOME/.dsh}
DSH_PROFILE=${DSH_PROFILE:-web}
NM="$DSH_HOME/profiles/$DSH_PROFILE/node_modules"
HOOK_DIR="$HOME/.claude/hooks"
FAIL=0
note() { printf '  %s\n' "$*"; }
ok()   { printf '✅ %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*"; }
err()  { printf '❌ %s\n' "$*"; FAIL=1; }

echo "== 1/3 patches/dsh-pocket-2.10.6"
TARGET="$NM/dsh-pocket/lib/index.js"
PATCH="$HERE/patches/dsh-pocket-2.10.6/dsh-pocket-2.10.6.patch"
if [ ! -f "$TARGET" ]; then
  warn "dsh-pocket 未安装，跳过"
elif grep -q 'loadOrCreateSessionKey' "$TARGET"; then
  ok "已打过补丁，跳过"
else
  if patch -d "$NM/dsh-pocket" -p1 --forward --dry-run < "$PATCH" >/dev/null 2>&1; then
    patch -d "$NM/dsh-pocket" -p1 --forward < "$PATCH" >/dev/null && ok "补丁已应用" || err "patch 执行失败"
  else
    err "补丁无法应用（pocket 版本可能已变）：$(grep -m1 '^+++b' "$PATCH" || true)"
    note "手动处理：对比 $TARGET 与 patches/dsh-pocket-2.10.6/upstream-package.json 记录的版本，"
    note "        把 loadOrCreateSessionKey + home 兜底两处改动移植过去"
  fi
fi

echo "== 2/3 files/hooks/tool-budget.sh"
mkdir -p "$HOOK_DIR" 2>/dev/null
if [ -f "$HOOK_DIR/tool-budget.sh" ] && ! cmp -s "$HERE/files/hooks/tool-budget.sh" "$HOOK_DIR/tool-budget.sh"; then
  cp -p "$HOOK_DIR/tool-budget.sh" "$HOOK_DIR/tool-budget.sh.bak.$(date +%Y%m%d%H%M%S)" && note "旧文件已备份"
fi
if install -m 755 "$HERE/files/hooks/tool-budget.sh" "$HOOK_DIR/tool-budget.sh" 2>/dev/null; then
  ok "hook 已安装（改脚本立即生效，无需重启）"
else
  err "hook 安装失败"
fi

echo "== 3/3 files/profile"
if [ "${1:-}" = "--with-profile" ]; then
  PDIR="$DSH_HOME/profiles/$DSH_PROFILE"
  [ -f "$PDIR/cordis.patch.yml" ] && cp -p "$PDIR/cordis.patch.yml" "$PDIR/cordis.patch.yml.bak.$(date +%Y%m%d%H%M%S)"
  install -m 644 "$HERE/files/profile/cordis.patch.yml" "$PDIR/cordis.patch.yml" \
    && ok "cordis.patch.yml 已覆盖（原文件已备份）" || err "cordis.patch.yml 覆盖失败"
else
  note "默认不碰 profile 配置（含本机其它设置）。对比："
  note "  diff $DSH_HOME/profiles/$DSH_PROFILE/cordis.patch.yml $HERE/files/profile/cordis.patch.yml"
  note "要覆盖加参数：./apply.sh --with-profile"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "重放完成。下一步："
  echo "  1) sudo systemctl restart dsh-web   # 插件源码改动要重启才装载（HMR 不看源码）"
  echo "  2) ./verify.sh                      # 冒烟验收"
else
  echo "有失败项（见上），处理后重跑 ./apply.sh"; exit 1
fi
