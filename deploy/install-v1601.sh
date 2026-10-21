#!/usr/bin/env bash
# V-1-6-1: 采购单按钮统一移到搜索框后，表格加勾选列、批量删除、清空列表。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1601.tar.gz
expected=1e34ac56b17f201b8c617ca8b9d7bbe7ad5df8f074f3440a420c0e217dd06436
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1601
test ! -e app-new-v1601

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v1601
tar -xzf "$archive" -C app-new-v1601
test -f app-new-v1601/server.js
test -d app-new-v1601/dist
test -d app-new-v1601/node_modules
grep -q "2026-10-21 V-1-6-1" -r app-new-v1601/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1601
chmod -R go-w app-new-v1601

systemctl stop gugemei.service
mv app app-prev2-v1601
mv app-new-v1601 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1601
  mv app-prev2-v1601 app
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
