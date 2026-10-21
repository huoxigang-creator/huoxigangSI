#!/usr/bin/env bash
# V-1-5-100: 扫描识别增加封边条/成品圆弧识别和智能排序。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v15100.tar.gz
expected=8d456e79af21bd3ae5f61e5eec0ecd31acdf01ecdc25c9b46f57fa604b56fb41
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v15100
test ! -e app-new-v15100

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v15100
tar -xzf "$archive" -C app-new-v15100
test -f app-new-v15100/server.js
test -d app-new-v15100/dist
test -d app-new-v15100/node_modules
grep -q "2026-10-21 V-1-5-100" -r app-new-v15100/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v15100
chmod -R go-w app-new-v15100

systemctl stop gugemei.service
mv app app-prev2-v15100
mv app-new-v15100 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v15100
  mv app-prev2-v15100 app
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
