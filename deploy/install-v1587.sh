#!/usr/bin/env bash
# V-1-5-87: AI 助手新增火山引擎·豆包模型接入.
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1587.tar.gz
expected=2c91fa347a9838120205c1314bfdf66f808dfb09933057f8c7e07ddf92f0641e
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1587
test ! -e app-new-v1587

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v1587
tar -xzf "$archive" -C app-new-v1587
test -f app-new-v1587/server.js
test -d app-new-v1587/dist
test -d app-new-v1587/node_modules
grep -q "2026-10-21 V-1-5-87" -r app-new-v1587/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1587
chmod -R go-w app-new-v1587

systemctl stop gugemei.service
mv app app-prev2-v1587
mv app-new-v1587 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1587
  mv app-prev2-v1587 app
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
