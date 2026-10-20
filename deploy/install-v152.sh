#!/usr/bin/env bash
# V-1-5-52: purchase order material picker merged into name column + sale price reference
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v152.tar.gz
expected=6190eb95f669189a6b77cc7afc4fc919a75c10d06e9993e7978f195cf1c651d6
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v152
test ! -e app-v152

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v152
tar -xzf "$archive" -C app-v152
test -f app-v152/server.js
test -d app-v152/dist
test -d app-v152/node_modules
grep -q "2026-10-19 V-1-5-52" -r app-v152/dist/client/_next/static/chunks/
grep -q "材料库下拉选择" -r app-v152/dist/client/_next/static/chunks/
grep -q "purchaseSalePrice" -r app-v152/dist/client/_next/static/chunks/
chown -R --reference=app app-v152
chmod -R go-w app-v152

systemctl stop gugemei.service
mv app app-prev-v152
mv app-v152 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v152
  mv app-prev-v152 app
  systemctl start gugemei.service
  echo "Deployment failed; previous version restored" >&2
  exit 1
}

systemctl start gugemei.service || rollback
sleep 2
systemctl is-active --quiet gugemei.service || rollback
curl --silent --fail --output /dev/null http://127.0.0.1:3700/login || rollback
curl --silent --output /dev/null --write-out "login_http=%{http_code}\n" http://127.0.0.1:3700/login
cat app/dist/server/BUILD_ID; echo
systemctl is-active gugemei.service
