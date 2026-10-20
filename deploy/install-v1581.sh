#!/usr/bin/env bash
# V-1-5-81: persistent customer quote toolbar, including empty customers.
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1581.tar.gz
expected=11913a528b346fc40ef0cd7319ce9a8d39c3ea7f0208e8a28faf510029655528
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1581
test ! -e app-new-v1581

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-new-v1581
tar -xzf "$archive" -C app-new-v1581
test -f app-new-v1581/server.js
test -d app-new-v1581/dist
test -d app-new-v1581/node_modules
grep -q "2026-10-20 V-1-5-81" -r app-new-v1581/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1581
chmod -R go-w app-new-v1581

systemctl stop gugemei.service
mv app app-prev2-v1581
mv app-new-v1581 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1581
  mv app-prev2-v1581 app
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
