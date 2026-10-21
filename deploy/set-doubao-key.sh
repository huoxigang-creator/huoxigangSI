#!/usr/bin/env bash
set -euo pipefail

if [[ $(id -u) -ne 0 ]]; then
  echo '请在阿里云 Workbench 的 root 终端运行。' >&2
  exit 1
fi

target=/etc/gugemei/ai.env
test -f "$target"
read -r -s -p '输入火山引擎方舟 API Key（ARK_API_KEY，不会显示）: ' doubao_key
echo
if [[ -z "$doubao_key" || "$doubao_key" == *$'\n'* || "$doubao_key" == *$'\r'* || "$doubao_key" == *' '* ]]; then
  echo 'API Key 格式无效，未修改配置。' >&2
  exit 1
fi

umask 077
temp=$(mktemp /etc/gugemei/ai.env.XXXXXX)
trap 'rm -f "$temp"' EXIT
grep -v '^GUGEMEI_DOUBAO_API_KEY=' "$target" > "$temp" || true
printf 'GUGEMEI_DOUBAO_API_KEY=%s\n' "$doubao_key" >> "$temp"
unset doubao_key
chown root:root "$temp"
chmod 600 "$temp"
mv "$temp" "$target"
trap - EXIT
systemctl restart gugemei.service
systemctl is-active --quiet gugemei.service
curl --silent --fail --output /dev/null http://127.0.0.1:3700/login
echo '豆包 API Key 已保存，固美格服务运行正常。'
echo '如需换模型或地址：编辑 /etc/gugemei/ai.env 的 GUGEMEI_DOUBAO_MODEL（默认 doubao-seed-1-6-251015，可改为你的推理接入点 ep-xxxx 或新模型名）与 GUGEMEI_DOUBAO_BASE_URL（默认 https://ark.cn-beijing.volces.com/api/v3），然后 systemctl restart gugemei.service'
