#!/usr/bin/env bash
# V-1-5-61: independent project card "收款" button recolored to #ff5722 (matches metric number color)
# NOTE: uses app-new-v161 / app-prev2-v161 to avoid colliding with legacy app-prev-v15x dirs (2026-10-15).
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v161.tar.gz
expected=713db04d564b04178343f33690605fdada80216980cc4eb08247445b7610f112
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v161
test ! -e app-new-v161

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-new-v161
tar -xzf "$archive" -C app-new-v161
test -f app-new-v161/server.js
test -d app-new-v161/dist
test -d app-new-v161/node_modules
grep -q "2026-10-19 V-1-5-61" -r app-new-v161/dist/client/_next/static/chunks/
grep -q "ff5722" -r app-new-v161/dist/client/_next/static/css/
chown -R --reference=app app-new-v161
chmod -R go-w app-new-v161

systemctl stop gugemei.service
mv app app-prev2-v161
mv app-new-v161 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v161
  mv app-prev2-v161 app
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
