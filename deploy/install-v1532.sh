#!/usr/bin/env bash
# V-1-5-32: 修复「导入全部料单」多文件汇总后明细乱序——合并完成后统一重排为 成品五金→铝材→封边材料，段内名称排序。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1532.tar.gz
expected=26e3a7a79dd86465ab7406bf6feb9bec85a719acb9ab754a318f6cafde5f84fc
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1532
test ! -e app-v1532

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1532
tar -xzf "$archive" -C app-v1532
test -f app-v1532/server.js
test -d app-v1532/dist
test -d app-v1532/node_modules
grep -q '2026-10-18 V-1-5-32' -r app-v1532/dist/client/_next/static/chunks/
chown -R --reference=app app-v1532
chmod -R go-w app-v1532

systemctl stop gugemei.service
mv app app-prev-v1532
mv app-v1532 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1532
  mv app-prev-v1532 app
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
