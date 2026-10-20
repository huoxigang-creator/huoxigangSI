#!/usr/bin/env bash
# V-1-5-18: 登录页副标题"登录阿里云独立副本"→"连云港固美格家具有限公司"（正式环境不应显示"副本"）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1518.tar.gz
expected=8b7f9c586afc057697421e1f32db61641eb573c53f835930d56b4c34db90e45b
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1518
test ! -e app-v1518

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1518
tar -xzf "$archive" -C app-v1518
test -f app-v1518/server.js
test -d app-v1518/dist
test -d app-v1518/node_modules
grep -q '2026-10-18 V-1-5-18' -r app-v1518/dist/client/_next/static/chunks/
chown -R --reference=app app-v1518
chmod -R go-w app-v1518

systemctl stop gugemei.service
mv app app-prev-v1518
mv app-v1518 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1518
  mv app-prev-v1518 app
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
