#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo '请在阿里云 Workbench 的 root 终端运行。' >&2
  exit 1
fi

target=/etc/gugemei/ai.env
test -f "$target"
read -r -s -p '输入 Anthropic 官方 Claude API Key（不会显示）: ' claude_key
echo
if [[ -z "$claude_key" || "$claude_key" == *$'\n'* || "$claude_key" == *$'\r'* || "$claude_key" == *' '* ]]; then
  echo 'API Key 格式无效，未修改配置。' >&2
  exit 1
fi

umask 077
temp=$(mktemp /etc/gugemei/ai.env.XXXXXX)
trap 'rm -f "$temp"' EXIT
grep -v '^GUGEMEI_CLAUDE_API_KEY=' "$target" > "$temp" || true
printf 'GUGEMEI_CLAUDE_API_KEY=%s\n' "$claude_key" >> "$temp"
unset claude_key
chown root:root "$temp"
chmod 600 "$temp"
mv "$temp" "$target"
trap - EXIT
systemctl restart gugemei.service
systemctl is-active --quiet gugemei.service
curl --silent --fail --output /dev/null http://127.0.0.1:3700/login
echo 'Claude API Key 已保存，固美格服务运行正常。'
