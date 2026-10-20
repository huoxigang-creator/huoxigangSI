#!/usr/bin/env bash
# V-1-5-56: trash purge (delete) button after refresh
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v156.tar.gz
expected=798735bde9fa0331acbff1ed65d4f1303207ebb16e540593b90fca151b1280e5
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v156
test ! -e app-v156

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v156
tar -xzf "$archive" -C app-v156
test -f app-v156/server.js
test -d app-v156/dist
test -d app-v156/node_modules
grep -q "2026-10-19 V-1-5-56" -r app-v156/dist/client/_next/static/chunks/
grep -q "永久删除已勾选" -r app-v156/dist/client/_next/static/chunks/
chown -R --reference=app app-v156
chmod -R go-w app-v156

systemctl stop gugemei.service
mv app app-prev-v156
mv app-v156 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v156
  mv app-prev-v156 app
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
