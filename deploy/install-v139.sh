#!/usr/bin/env bash
# V-1-5-39: 「打印 A4」草稿打印稿与《九璋赋18-1-1402-预算报价.xls》同款排版配色，文字自动换行撑高，A4 分页。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v139.tar.gz
expected=de39b71ccc147627656ce66ab1c1c3b592578d60a1f12ba24ec7be4620ecda54
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v139
test ! -e app-v139

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v139
tar -xzf "$archive" -C app-v139
test -f app-v139/server.js
test -d app-v139/dist
test -d app-v139/node_modules
grep -q '2026-10-18 V-1-5-39' -r app-v139/dist/client/_next/static/chunks/
grep -q 'qwPrFee' -r app-v139/dist/client/_next/static/chunks/
chown -R --reference=app app-v139
chmod -R go-w app-v139

systemctl stop gugemei.service
mv app app-prev-v139
mv app-v139 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v139
  mv app-prev-v139 app
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
