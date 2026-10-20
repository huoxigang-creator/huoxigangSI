#!/usr/bin/env bash
# V-1-5-13: 分享客户进展支持短信发送给客户（通知模板配置后可用）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1513.tar.gz
expected=b6586770a75457baa061deb228533b49009552c6fd5cb5edef09dae7e8db8373
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1513
test ! -e app-v1513

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1513
tar -xzf "$archive" -C app-v1513
test -f app-v1513/server.js
test -d app-v1513/dist
test -d app-v1513/node_modules
grep -q '2026-10-17 V-1-5-13' -r app-v1513/dist/client/_next/static/chunks/
chown -R --reference=app app-v1513
chmod -R go-w app-v1513

systemctl stop gugemei.service
mv app app-prev-v1513
mv app-v1513 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1513
  mv app-prev-v1513 app
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
