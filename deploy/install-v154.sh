#!/usr/bin/env bash
# V-1-5-54: labor quantity note removed; elevator fee = 5mm+18mm boards; transport fee default 1; blank default quantity
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v154.tar.gz
expected=c7c91bd723d4a2e747b0e13787c8b4f9b06eb83b54ea36cf1da0bfd0c92f06bc
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v154
test ! -e app-v154

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v154
tar -xzf "$archive" -C app-v154
test -f app-v154/server.js
test -d app-v154/dist
test -d app-v154/node_modules
grep -q "2026-10-19 V-1-5-54" -r app-v154/dist/client/_next/static/chunks/
grep -q "电梯上楼费" -r app-v154/dist/client/_next/static/chunks/
grep -q "运输费" -r app-v154/dist/client/_next/static/chunks/
chown -R --reference=app app-v154
chmod -R go-w app-v154

systemctl stop gugemei.service
mv app app-prev-v154
mv app-v154 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v154
  mv app-prev-v154 app
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
