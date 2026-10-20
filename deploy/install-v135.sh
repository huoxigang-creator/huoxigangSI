#!/usr/bin/env bash
# V-1-5-35: 五金导入——个别不合格行（名称空白/数量无效）不再卡死「加入五金明细」按钮，合格行全部可加入、不合格行自动跳过。
# 同时包含 V-1-5-34（未匹配单价按0元加入）与修复 quote-rooms.tsx 语法错误后的「复制空间」功能。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v135.tar.gz
expected=677f0181b53697c029f0d7de9100524f195e38601b75b5cf67809d56966d12db
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v135
test ! -e app-v135

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v135
tar -xzf "$archive" -C app-v135
test -f app-v135/server.js
test -d app-v135/dist
test -d app-v135/node_modules
grep -q '2026-10-18 V-1-5-35' -r app-v135/dist/client/_next/static/chunks/
grep -q '项待核对（加入时自动跳过）' -r app-v135/dist/client/_next/static/chunks/
chown -R --reference=app app-v135
chmod -R go-w app-v135

systemctl stop gugemei.service
mv app app-prev-v135
mv app-v135 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v135
  mv app-prev-v135 app
  systemctl start gugemei.service
  echo 'Deployment failed; previous version restored' >&2
  exit 1
}

systemctl start gugemei.service || rollback
sleep 2
systemctl is-active --quiet gugemei.service || rollback
curl --silent --fail --output /dev/null http://127.0.0.1:3700/login || rollback
curl --silent --output /dev/null --write-out 'login_http=%{http_code}\n' http://127.0.0.1:3700/login
cat app/dist/server/BUILD_ID; echo
systemctl is-active gugemei.service
