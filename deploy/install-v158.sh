#!/usr/bin/env bash
# V-1-5-58: independent project cards gain a "收款" button after "删除项目"; opens receipt dialog preselected to that subproject
# NOTE: legacy dirs app-prev-v158 / app-prev-v159 (2026-10-15) already exist on the server, so this build uses
# app-new-v158 / app-prev2-v158 to avoid colliding with historical rollback directories.
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v158.tar.gz
expected=f0608c9855e90970dbefb561ec22ed7d96baa7ca1232d3d0a341135678c4bc20
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v158
test ! -e app-new-v158

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-new-v158
tar -xzf "$archive" -C app-new-v158
test -f app-new-v158/server.js
test -d app-new-v158/dist
test -d app-new-v158/node_modules
grep -q "2026-10-19 V-1-5-58" -r app-new-v158/dist/client/_next/static/chunks/
grep -q "自动选中对应小项目" -r app-new-v158/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v158
chmod -R go-w app-new-v158

systemctl stop gugemei.service
mv app app-prev2-v158
mv app-new-v158 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v158
  mv app-prev2-v158 app
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
