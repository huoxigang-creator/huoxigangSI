#!/usr/bin/env bash
# V-1-5-40: 导出 Excel 长文字自动换行撑高不截断，规格型号列加宽，全表边框完整。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v140.tar.gz
expected=86afec4b57128e68d567c3fa6827eca79becf5154b70587f5ec494496e31334a
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v140
test ! -e app-v140

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v140
tar -xzf "$archive" -C app-v140
test -f app-v140/server.js
test -d app-v140/dist
test -d app-v140/node_modules
grep -q '2026-10-18 V-1-5-40' -r app-v140/dist/client/_next/static/chunks/
chown -R --reference=app app-v140
chmod -R go-w app-v140

systemctl stop gugemei.service
mv app app-prev-v140
mv app-v140 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v140
  mv app-prev-v140 app
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
