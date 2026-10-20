#!/usr/bin/env bash
# V-1-5-10: accounting fixes (WeChat over-collection guard, merchant receipts
# cannot be voided/deleted, unified decimal rounding, delete-project warning).
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1510.tar.gz
expected=5525df4317d5b37fe6ed0e3eb51b49f6182eee581fb69ef0e8c12f99f675dadb
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v159
test ! -e app-v1510

# 1. Back up the database and files with the existing backup unit, and confirm it ran.
before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

# 2. Unpack the new version next to the running one.
mkdir app-v1510
tar -xzf "$archive" -C app-v1510
test -f app-v1510/server.js
test -d app-v1510/dist
test -d app-v1510/node_modules
grep -q '2026-10-17 V-1-5-10' -r app-v1510/dist/client/_next/static/chunks/
chown -R --reference=app app-v1510
chmod -R go-w app-v1510

# 3. Switch; keep the old version as app-prev-v159 for instant rollback.
systemctl stop gugemei.service
mv app app-prev-v159
mv app-v1510 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1510
  mv app-prev-v159 app
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
