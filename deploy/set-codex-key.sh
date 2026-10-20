#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo '请在阿里云 Workbench 的 root 终端运行。' >&2
  exit 1
fi

target=/etc/gugemei/ai.env
test -f "$target"
read -r -s -p '输入 OpenAI 官方 API Key（sk- 开头，不会显示）: ' codex_key
echo
if [[ -z "$codex_key" || "$codex_key" == *$'\n'* || "$codex_key" == *$'\r'* || "$codex_key" == *' '* ]]; then
  echo 'API Key 格式无效，未修改配置。' >&2
  exit 1
fi

umask 077
temp=$(mktemp /etc/gugemei/ai.env.XXXXXX)
trap 'rm -f "$temp"' EXIT
grep -v '^GUGEMEI_CODEX_API_KEY=' "$target" > "$temp" || true
printf 'GUGEMEI_CODEX_API_KEY=%s\n' "$codex_key" >> "$temp"
unset codex_key
chown root:root "$temp"
chmod 600 "$temp"
mv "$temp" "$target"
trap - EXIT
systemctl restart gugemei.service
systemctl is-active --quiet gugemei.service
curl --silent --fail --output /dev/null http://127.0.0.1:3700/login
echo 'Codex API Key 已保存，固美格服务运行正常。'
echo '如需换模型或地址：编辑 /etc/gugemei/ai.env 的 GUGEMEI_CODEX_MODEL（默认 gpt-5-codex）与 GUGEMEI_CODEX_BASE_URL（默认 https://api.openai.com/v1），然后 systemctl restart gugemei.service'
