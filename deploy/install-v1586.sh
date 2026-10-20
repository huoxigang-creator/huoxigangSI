#!/usr/bin/env bash
# V-1-5-86: Project quote toolbar, copy and shared print layout.
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1586.tar.gz
expected=4a042011c4dfd302dc78550e6443b00edccd4083fcc0452e650d4d274c989891
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1586
test ! -e app-new-v1586

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v1586
tar -xzf "$archive" -C app-new-v1586
test -f app-new-v1586/server.js
test -d app-new-v1586/dist
test -d app-new-v1586/node_modules
grep -q "2026-10-21 V-1-5-86" -r app-new-v1586/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1586
chmod -R go-w app-new-v1586

systemctl stop gugemei.service
mv app app-prev2-v1586
mv app-new-v1586 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1586
  mv app-prev2-v1586 app
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

