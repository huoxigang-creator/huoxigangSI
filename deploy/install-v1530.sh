#!/usr/bin/env bash
# V-1-5-30: 修复料单导入「表格中没有可导入的明细」——段标题(1.成品五金/2.封边材料)后紧跟的列表头不再被误判为段落结束。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1530.tar.gz
expected=fff9d7842a2aefe7710dbb999b7fb3f68e22f72b8a354e682e6f0418b2e14e5d
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1530
test ! -e app-v1530

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1530
tar -xzf "$archive" -C app-v1530
test -f app-v1530/server.js
test -d app-v1530/dist
test -d app-v1530/node_modules
grep -q '2026-10-18 V-1-5-30' -r app-v1530/dist/client/_next/static/chunks/
chown -R --reference=app app-v1530
chmod -R go-w app-v1530

systemctl stop gugemei.service
mv app app-prev-v1530
mv app-v1530 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1530
  mv app-prev-v1530 app
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
