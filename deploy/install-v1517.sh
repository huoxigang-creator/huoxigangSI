#!/usr/bin/env bash
# V-1-5-17: 修复 /api/catalog、/api/trash、/api/contracts、/api/quote-shares、/api/payment-codes、/api/hardware-import、/api/project-files、/api/payment-vouchers、/api/confirm-files 等 API 在 nginx 清空 Origin 时误报"不允许跨站操作"(403) 的问题（origin 空值保护，与 /api/manage 一致）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1517.tar.gz
expected=b2821469d528655b17099ef5180c5ea2e2fab7c58365e90b1eabb4ad23ebc6f1
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1517
test ! -e app-v1517

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1517
tar -xzf "$archive" -C app-v1517
test -f app-v1517/server.js
test -d app-v1517/dist
test -d app-v1517/node_modules
grep -q '2026-10-18 V-1-5-17' -r app-v1517/dist/client/_next/static/chunks/
chown -R --reference=app app-v1517
chmod -R go-w app-v1517

systemctl stop gugemei.service
mv app app-prev-v1517
mv app-v1517 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1517
  mv app-prev-v1517 app
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
