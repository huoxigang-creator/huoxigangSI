#!/usr/bin/env bash
# V-1-5-40: 瀵煎嚭 Excel 闀挎枃瀛楄嚜鍔ㄦ崲琛屾拺楂樹笉鎴柇锛岃鏍煎瀷鍙峰垪鍔犲锛屽叏琛ㄨ竟妗嗗畬鏁淬€?set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v149.tar.gz
expected=dfebf8c368d6373313d24c269b263d7f2b292d9c690e7a377f5f54fe0b482967
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v149
test ! -e app-v149

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v149
tar -xzf "$archive" -C app-v149
test -f app-v149/server.js
test -d app-v149/dist
test -d app-v149/node_modules
grep -q '2026-10-18 V-1-5-45' -r app-v149/dist/client/_next/static/chunks/
chown -R --reference=app app-v149
chmod -R go-w app-v149

systemctl stop gugemei.service
mv app app-prev-v149
mv app-v149 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v149
  mv app-prev-v149 app
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

