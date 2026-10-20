#!/usr/bin/env bash
# V-1-5-11: login page background, SMS verification login, forgot-password reset, account phone binding.
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1511.tar.gz
expected=55f78e3bdc47d3449f9f739accbaa4351f5cc0ba555399a68ab0b46bffb53aae
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1510
test ! -e app-v1511

# 1. Back up the database and files with the existing backup unit, and confirm it ran.
before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

# 2. Unpack the new version next to the running one.
mkdir app-v1511
tar -xzf "$archive" -C app-v1511
test -f app-v1511/server.js
test -d app-v1511/dist
test -d app-v1511/node_modules
grep -q '2026-10-17 V-1-5-11' -r app-v1511/dist/client/_next/static/chunks/
chown -R --reference=app app-v1511
chmod -R go-w app-v1511

# 3. Switch; keep the old version as app-prev-v1510 for instant rollback.
systemctl stop gugemei.service
mv app app-prev-v1510
mv app-v1511 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1511
  mv app-prev-v1510 app
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
