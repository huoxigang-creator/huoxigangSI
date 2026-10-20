#!/usr/bin/env bash
# V-1-5-12: 个人设置（改用户名/姓名/手机号、修改密码，老板与员工通用）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1512.tar.gz
expected=f89cb22512ac191d34f50c6b630a86d4739e80a1f5179cf06228e8742d9f2df8
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1512
test ! -e app-v1512

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1512
tar -xzf "$archive" -C app-v1512
test -f app-v1512/server.js
test -d app-v1512/dist
test -d app-v1512/node_modules
grep -q '2026-10-17 V-1-5-12' -r app-v1512/dist/client/_next/static/chunks/
chown -R --reference=app app-v1512
chmod -R go-w app-v1512

systemctl stop gugemei.service
mv app app-prev-v1512
mv app-v1512 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1512
  mv app-prev-v1512 app
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
