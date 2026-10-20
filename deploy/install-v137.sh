#!/usr/bin/env bash
# V-1-5-37: 草稿「导出 Excel」改为与历史预算报价单相同的排版配色（蓝底标题/客户行、灰底分类段小计、黄底费用项、报价合计、乙方甲方）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v137.tar.gz
expected=1640f277a699552de50deb6c9542e8598d8ae87dd527194b5d77cc24dc9e7bf8
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v137
test ! -e app-v137

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v137
tar -xzf "$archive" -C app-v137
test -f app-v137/server.js
test -d app-v137/dist
test -d app-v137/node_modules
grep -q '2026-10-18 V-1-5-37' -r app-v137/dist/client/_next/static/chunks/
grep -q '销售清单' -r app-v137/dist/client/_next/static/chunks/
chown -R --reference=app app-v137
chmod -R go-w app-v137

systemctl stop gugemei.service
mv app app-prev-v137
mv app-v137 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v137
  mv app-prev-v137 app
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
