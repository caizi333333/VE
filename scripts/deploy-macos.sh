#!/usr/bin/env bash
# Update the existing single-instance Mac service; preserve local data and old build.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
if [ "$(uname -s)" != Darwin ]; then
  echo '此脚本仅用于现有 macOS LaunchAgent 服务。' >&2
  exit 1
fi
ve_release="${1:-}"
if [[ ! "$ve_release" =~ ^[0-9a-f]{40}$ ]]; then
  echo '请传入已验证的完整主分支提交 SHA。' >&2
  exit 1
fi
ve_plist="${VE_DEPLOY_PLIST:-$HOME/Library/LaunchAgents/com.sunyancai.ve-app.plist}"
ve_dir="$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["WorkingDirectory"])' "$ve_plist")"
ve_dist="$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb")).get("EnvironmentVariables",{}).get("NEXT_DIST_DIR",".next"))' "$ve_plist")"
if [[ "$ve_dist" != .next* || "$ve_dist" == */* ]]; then
  echo '构建目录配置不符合当前部署方式，尚未停止服务。' >&2
  exit 1
fi
cd "$ve_dir"
test "$(git branch --show-current)" = main
if [ -n "$(git status --porcelain)" ]; then
  echo '项目存在本地修改，尚未停止服务；请先处理并保留修改。' >&2
  exit 1
fi
ve_origin="$(git remote get-url origin)"
case "$ve_origin" in
  https://github.com/caizi333333/VE|https://github.com/caizi333333/VE.git|git@github.com:caizi333333/VE.git) ;;
  *) echo '启动项所指目录不是预期的 VE 仓库，尚未停止服务。' >&2; exit 1 ;;
esac
git fetch origin main
git rev-parse --verify "$ve_release^{commit}" >/dev/null
git merge-base --is-ancestor "$ve_release" origin/main
if ! git diff --quiet HEAD "$ve_release" -- package.json package-lock.json; then
  echo '运行依赖发生变化，不能复用现有 node_modules；尚未停止服务，请按完整依赖更新流程部署。' >&2
  exit 1
fi
test -d node_modules
test -d "$ve_dist"
git merge --ff-only "$ve_release"
ve_target="gui/$(id -u)"
ve_backup="$(mktemp -d "${TMPDIR:-/tmp}/ve-release.XXXXXX")"
launchctl bootout "$ve_target" "$ve_plist"
ve_restore() {
  trap - ERR
  set +e
  launchctl bootout "$ve_target" "$ve_plist" 2>/dev/null
  if [ -d "$ve_backup/$ve_dist" ]; then
    [ ! -e "$ve_dist" ] || mv "$ve_dist" "$ve_backup/failed-build"
    mv "$ve_backup/$ve_dist" "$ve_dist"
  fi
  launchctl bootstrap "$ve_target" "$ve_plist"
  echo "更新失败，已尝试恢复旧构建；源代码仍在更新后的版本。备份：$ve_backup" >&2
  exit 1
}
trap ve_restore ERR
mv "$ve_dist" "$ve_backup/$ve_dist"
NEXT_DIST_DIR="$ve_dist" npm run build
launchctl bootstrap "$ve_target" "$ve_plist"
ve_ready=0
for ve_attempt in {1..15}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3110/api/health; then
    ve_ready=1
    break
  fi
  sleep 2
done
test "$ve_ready" = 1
trap - ERR
echo
echo '【新版已启动】'
git log -1 --oneline
echo "旧构建备份：$ve_backup"
