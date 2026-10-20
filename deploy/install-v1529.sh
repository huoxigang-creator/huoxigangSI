#!/usr/bin/env bash
# V-1-5-29: 料单导入只取五金工作表中「成品五金/铝材/封边」段落，其余不导入；结果按名称排序、同名排在一起。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1529.tar.gz
expected=d55ec65dade04e80a9b1ab2205bc1d5acf8179bf525b551a12156648d4a1083b
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1529
test ! -e app-v1529

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1529
tar -xzf "$archive" -C app-v1529
test -f app-v1529/server.js
test -d app-v1529/dist
test -d app-v1529/node_modules
grep -q '2026-10-18 V-1-5-29' -r app-v1529/dist/client/_next/static/chunks/
grep -q '成品五金 / 铝材 / 封边' -r app-v1529/dist/client/_next/static/chunks/
chown -R --reference=app app-v1529
chmod -R go-w app-v1529

systemctl stop gugemei.service
mv app app-prev-v1529
mv app-v1529 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1529
  mv app-prev-v1529 app
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
