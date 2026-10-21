#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1613.tar.gz
expected=3610b0ad09ebda7386bb127f5fbe21b1f1517984ea8ee30481d62e32ebcc423c
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1613
test ! -e app-new-v1613

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v1613
tar -xzf "$archive" -C app-new-v1613
test -f app-new-v1613/server.js
test -d app-new-v1613/dist
test -d app-new-v1613/node_modules
grep -q "2026-10-22 V-1-6-13" -r app-new-v1613/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1613
chmod -R go-w app-new-v1613

systemctl stop gugemei.service
mv app app-prev2-v1613
mv app-new-v1613 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1613
  mv app-prev2-v1613 app
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
