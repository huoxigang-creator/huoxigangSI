#!/usr/bin/env bash
# V-1-5-20: ①客户确定=下拉选择采纳报价并导入全部明细；②报价明细表格去掉"空间"列，金额后新增每行图片（上传/缩略图/持久化）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1520.tar.gz
expected=691993c8a1b82eb1dee76b24324433fc0740d1ece31670e7c31bef241f6604b0
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1520
test ! -e app-v1520

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1520
tar -xzf "$archive" -C app-v1520
test -f app-v1520/server.js
test -d app-v1520/dist
test -d app-v1520/node_modules
grep -q '2026-10-18 V-1-5-20' -r app-v1520/dist/client/_next/static/chunks/
grep -q 'quote-item-photos' -r app-v1520/dist/client/_next/static/chunks/
grep -q '已采纳报价（下拉选择导入明细）\|adoptedQuotes' -r app-v1520/dist/client/_next/static/chunks/
chown -R --reference=app app-v1520
chmod -R go-w app-v1520

systemctl stop gugemei.service
mv app app-prev-v1520
mv app-v1520 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1520
  mv app-prev-v1520 app
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
