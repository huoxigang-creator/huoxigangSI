#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1608.tar.gz
expected=469baf4f71374cf59b7abaf42abbde78d1a8f2ee3b9bff5c09eb32978735d6fb
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1608
test ! -e app-new-v1608

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v1608
tar -xzf "$archive" -C app-new-v1608
test -f app-new-v1608/server.js
test -d app-new-v1608/dist
test -d app-new-v1608/node_modules
grep -q "2026-10-22 V-1-6-8" -r app-new-v1608/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1608
chmod -R go-w app-new-v1608

systemctl stop gugemei.service
mv app app-prev2-v1608
mv app-new-v1608 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1608
  mv app-prev2-v1608 app
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
