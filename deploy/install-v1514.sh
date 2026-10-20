#!/usr/bin/env bash
# V-1-5-14: 新增客户确认单——选材与待确定信息打包为微信链接，客户逐项确认并手写签字，结果回传存档。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1514.tar.gz
expected=cc5d0d987fb659839eab1ca6cb166b8ffcbb229b66d6b599381c181ae0d3a775
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1514
test ! -e app-v1514

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1514
tar -xzf "$archive" -C app-v1514
test -f app-v1514/server.js
test -d app-v1514/dist
test -d app-v1514/node_modules
grep -q '2026-10-17 V-1-5-14' -r app-v1514/dist/client/_next/static/chunks/
chown -R --reference=app app-v1514
chmod -R go-w app-v1514

systemctl stop gugemei.service
mv app app-prev-v1514
mv app-v1514 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1514
  mv app-prev-v1514 app
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
