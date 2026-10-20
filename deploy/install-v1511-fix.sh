#!/usr/bin/env bash
# V-1-5-11 fix: AI-tech login background + proxy whitelist for anonymous SMS/forgot API.
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1511.tar.gz
expected=42cac1547dd53c80ae21c734c980f94cc68c080504e7152d51fcd2d48754874d
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1511a
test ! -e app-v1511b

# 1. Back up the database.
before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

# 2. Unpack.
mkdir app-v1511b
tar -xzf "$archive" -C app-v1511b
test -f app-v1511b/server.js
test -d app-v1511b/dist
test -d app-v1511b/node_modules
grep -q '2026-10-17 V-1-5-11' -r app-v1511b/dist/client/_next/static/chunks/
chown -R --reference=app app-v1511b
chmod -R go-w app-v1511b

# 3. Switch; keep previous v1511 as app-prev-v1511a (v1510 rollback point app-prev-v1510 stays untouched).
systemctl stop gugemei.service
mv app app-prev-v1511a
mv app-v1511b app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1511
  mv app-prev-v1511a app
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
