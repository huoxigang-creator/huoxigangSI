#!/usr/bin/env bash
# V-1-5-28: 修复「导入全部料单」500 条上限误用合并前行数判断的问题，改为按汇总合并后的行数校验。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1528.tar.gz
expected=929ddccf98cfc4b5442784716872659d3138f0eeb5e0d929c5b662ac8e4aad04
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1528
test ! -e app-v1528

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1528
tar -xzf "$archive" -C app-v1528
test -f app-v1528/server.js
test -d app-v1528/dist
test -d app-v1528/node_modules
grep -q '2026-10-18 V-1-5-28' -r app-v1528/dist/client/_next/static/chunks/
grep -q '按名称汇总成' -r app-v1528/dist/client/_next/static/chunks/
chown -R --reference=app app-v1528
chmod -R go-w app-v1528

systemctl stop gugemei.service
mv app app-prev-v1528
mv app-v1528 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1528
  mv app-prev-v1528 app
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
