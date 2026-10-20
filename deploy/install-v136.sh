#!/usr/bin/env bash
# V-1-5-36: 打印 A4 草稿不再显示销售单价/金额/小计/总合计；「打印 A4」前新增「导出 Excel」，排版与打印一致但保留单价、金额与总合计。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v136.tar.gz
expected=ac99a259b6b42cf67632f03e2e7c7a0680744e2f02d4f79b2268f576d38653e4
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v136
test ! -e app-v136

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v136
tar -xzf "$archive" -C app-v136
test -f app-v136/server.js
test -d app-v136/dist
test -d app-v136/node_modules
grep -q '2026-10-18 V-1-5-36' -r app-v136/dist/client/_next/static/chunks/
grep -q '导出 Excel（含单价金额）' -r app-v136/dist/client/_next/static/chunks/
chown -R --reference=app app-v136
chmod -R go-w app-v136

systemctl stop gugemei.service
mv app app-prev-v136
mv app-v136 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v136
  mv app-prev-v136 app
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
