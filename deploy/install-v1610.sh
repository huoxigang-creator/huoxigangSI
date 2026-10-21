#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1610.tar.gz
expected=b424343e6a0ad765aae43fe71e06a37da1102ead418f421f951ef7a1d61e908c
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1610
test ! -e app-new-v1610

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v1610
tar -xzf "$archive" -C app-new-v1610
test -f app-new-v1610/server.js
test -d app-new-v1610/dist
test -d app-new-v1610/node_modules
grep -q "2026-10-22 V-1-6-10" -r app-new-v1610/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1610
chmod -R go-w app-new-v1610

systemctl stop gugemei.service
mv app app-prev2-v1610
mv app-new-v1610 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1610
  mv app-prev2-v1610 app
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
