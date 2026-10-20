#!/usr/bin/env bash
# V-1-5-53: parent customer purchase order list shows independent-project orders
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v153.tar.gz
expected=6fd86c5fa8629d99c895b0c16ebcdee005c1abe71123d6a55921ff26ab5c41b9
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v153
test ! -e app-v153

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v153
tar -xzf "$archive" -C app-v153
test -f app-v153/server.js
test -d app-v153/dist
test -d app-v153/node_modules
grep -q "2026-10-19 V-1-5-53" -r app-v153/dist/client/_next/static/chunks/
grep -q "材料库下拉选择" -r app-v153/dist/client/_next/static/chunks/
grep -q "purchaseSalePrice" -r app-v153/dist/client/_next/static/chunks/
chown -R --reference=app app-v153
chmod -R go-w app-v153

systemctl stop gugemei.service
mv app app-prev-v153
mv app-v153 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v153
  mv app-prev-v153 app
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
