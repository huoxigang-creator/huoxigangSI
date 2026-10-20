#!/usr/bin/env bash
# V-1-5-38: 所有表格滚动时表头吸顶固定；报价保存校验放宽为仅「数量必须大于0」，名称/单位/单价不再强制（空单价按 0 保存）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v138.tar.gz
expected=2a984fe173be4a66f09e4e3a8f23fd6aed1ac2e74f6a12ac911f049fde4c92b6
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v138
test ! -e app-v138

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v138
tar -xzf "$archive" -C app-v138
test -f app-v138/server.js
test -d app-v138/dist
test -d app-v138/node_modules
grep -q '2026-10-18 V-1-5-38' -r app-v138/dist/client/_next/static/chunks/
grep -q '数量必须大于 0' -r app-v138/dist/client/_next/static/chunks/
chown -R --reference=app app-v138
chmod -R go-w app-v138

systemctl stop gugemei.service
mv app app-prev-v138
mv app-v138 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v138
  mv app-prev-v138 app
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
