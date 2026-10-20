#!/usr/bin/env bash
# V-1-5-27: 「全部料单导入」改名「导入全部料单」；多文件汇总为「五金单统计」，名称+规格型号+单位相同的明细自动合并、数量累计。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1527.tar.gz
expected=1834fc6a96067cd57129ac0224dc42519a8652d1bf4f6afef63994d6885977a3
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1527
test ! -e app-v1527

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1527
tar -xzf "$archive" -C app-v1527
test -f app-v1527/server.js
test -d app-v1527/dist
test -d app-v1527/node_modules
grep -q '2026-10-18 V-1-5-27' -r app-v1527/dist/client/_next/static/chunks/
grep -q '导入全部料单' -r app-v1527/dist/client/_next/static/chunks/
grep -q '五金单统计' -r app-v1527/dist/client/_next/static/chunks/
chown -R --reference=app app-v1527
chmod -R go-w app-v1527

systemctl stop gugemei.service
mv app app-prev-v1527
mv app-v1527 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1527
  mv app-prev-v1527 app
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
