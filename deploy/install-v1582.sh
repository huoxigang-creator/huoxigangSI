#!/usr/bin/env bash
# V-1-5-82: Excel-layout customer quote confirmation and signed receipts.
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1582.tar.gz
expected=ef77cd1d9632bdc9beec374882016e3a3bc847dd6e39419c19b241ef17cc55b1
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1582
test ! -e app-new-v1582

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | head -1)
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | head -1)
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-new-v1582
tar -xzf "$archive" -C app-new-v1582
test -f app-new-v1582/server.js
test -d app-new-v1582/dist
test -d app-new-v1582/node_modules
grep -q "2026-10-20 V-1-5-82" -r app-new-v1582/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1582
chmod -R go-w app-new-v1582

systemctl stop gugemei.service
mv app app-prev2-v1582
mv app-new-v1582 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1582
  mv app-prev2-v1582 app
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
