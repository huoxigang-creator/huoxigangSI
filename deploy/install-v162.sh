#!/usr/bin/env bash
# V-1-5-62: fix SMS share "项目不存在" false negative (COALESCE on deleted filter)
# NOTE: uses app-new-v162 / app-prev2-v162 to avoid colliding with legacy app-prev-v15x dirs (2026-10-15).
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v162.tar.gz
expected=7ba24e9fc0ba401ffcb3e507f893352893723d67efcb8d7b4f5c42c56c6c017d
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v162
test ! -e app-new-v162

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-new-v162
tar -xzf "$archive" -C app-new-v162
test -f app-new-v162/server.js
test -d app-new-v162/dist
test -d app-new-v162/node_modules
grep -q "2026-10-19 V-1-5-62" -r app-new-v162/dist/client/_next/static/chunks/
grep -q "COALESCE(json_extract(data, '\$.deleted'), 0) = 0" -r app-new-v162/dist/server/
chown -R --reference=app app-new-v162
chmod -R go-w app-new-v162

systemctl stop gugemei.service
mv app app-prev2-v162
mv app-new-v162 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v162
  mv app-prev2-v162 app
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
