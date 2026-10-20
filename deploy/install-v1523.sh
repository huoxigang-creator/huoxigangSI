#!/usr/bin/env bash
# V-1-5-23: 顶栏版本号可点击，弹出「更新日志」弹窗，按版本倒序列出每次功能/界面更新内容。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1523.tar.gz
expected=89e28add4a676ede513c9996ae5df76d32d16a3a98c9574b224533fc321d0fde
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1523
test ! -e app-v1523

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1523
tar -xzf "$archive" -C app-v1523
test -f app-v1523/server.js
test -d app-v1523/dist
test -d app-v1523/node_modules
grep -q '2026-10-18 V-1-5-23' -r app-v1523/dist/client/_next/static/chunks/
grep -q '更新日志' -r app-v1523/dist/client/_next/static/chunks/
chown -R --reference=app app-v1523
chmod -R go-w app-v1523

systemctl stop gugemei.service
mv app app-prev-v1523
mv app-v1523 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1523
  mv app-prev-v1523 app
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
