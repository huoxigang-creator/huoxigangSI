#!/usr/bin/env bash
# V-1-5-57: hardware import merges same-name rows (specs listed together); handle (免拉手) converted to meters; LED strips (灯带) to millimeters
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v157.tar.gz
expected=099655def557eb5b5190f25d6e3a3ad14cf62a605b3b7292aebe48cfdfa5d1cd
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v157
test ! -e app-v157

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v157
tar -xzf "$archive" -C app-v157
test -f app-v157/server.js
test -d app-v157/dist
test -d app-v157/node_modules
grep -q "2026-10-19 V-1-5-57" -r app-v157/dist/client/_next/static/chunks/
grep -q "折算为" -r app-v157/dist/client/_next/static/chunks/
chown -R --reference=app app-v157
chmod -R go-w app-v157

systemctl stop gugemei.service
mv app app-prev-v157
mv app-v157 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v157
  mv app-prev-v157 app
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
