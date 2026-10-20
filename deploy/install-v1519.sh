#!/usr/bin/env bash
# V-1-5-19: HTTP（非安全上下文）下 crypto.randomUUID 不可用，导致新建项目/新建报价/添加房间前端崩溃。
# 在 root layout 注入客户端 polyfill（getRandomValues 实现 v4 UUID）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1519.tar.gz
expected=88260218d47d618cf6f4dcf6557f586832aa1e81920c179c7ee584ce06f2bb22
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1519
test ! -e app-v1519

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1519
tar -xzf "$archive" -C app-v1519
test -f app-v1519/server.js
test -d app-v1519/dist
test -d app-v1519/node_modules
grep -q '2026-10-18 V-1-5-19' -r app-v1519/dist/client/_next/static/chunks/
grep -q 'randomUUIDFallback\|getRandomValues' -r app-v1519/dist/client/_next/static/chunks/
chown -R --reference=app app-v1519
chmod -R go-w app-v1519

systemctl stop gugemei.service
mv app app-prev-v1519
mv app-v1519 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1519
  mv app-prev-v1519 app
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
