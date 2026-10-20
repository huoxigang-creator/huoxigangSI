#!/usr/bin/env bash
# V-1-5-22: 项目详情「首页」页签布局调整——「独立项目」板块（含添加项目、项目卡片、新建报价/删除项目）移到页面最顶部，排在「下一步安排」「报价状态」「最近动态」之前。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1522.tar.gz
expected=a8dce5aee0758755808d73d719a6e9875cc20253827156087445cb0e7675055a
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1522
test ! -e app-v1522

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1522
tar -xzf "$archive" -C app-v1522
test -f app-v1522/server.js
test -d app-v1522/dist
test -d app-v1522/node_modules
grep -q '2026-10-18 V-1-5-22' -r app-v1522/dist/client/_next/static/chunks/
grep -q '独立项目' -r app-v1522/dist/client/_next/static/chunks/
chown -R --reference=app app-v1522
chmod -R go-w app-v1522

systemctl stop gugemei.service
mv app app-prev-v1522
mv app-v1522 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1522
  mv app-prev-v1522 app
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
