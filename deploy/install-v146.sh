#!/usr/bin/env bash
# V-1-5-40: 瀵煎嚭 Excel 闀挎枃瀛楄嚜鍔ㄦ崲琛屾拺楂樹笉鎴柇锛岃鏍煎瀷鍙峰垪鍔犲锛屽叏琛ㄨ竟妗嗗畬鏁淬€?set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v146.tar.gz
expected=8e0063d8a8666708730e8f7c045e960326e2d8eb2a9dca84d88365b69f7e6a14
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v146
test ! -e app-v146

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v146
tar -xzf "$archive" -C app-v146
test -f app-v146/server.js
test -d app-v146/dist
test -d app-v146/node_modules
grep -q '2026-10-18 V-1-5-45' -r app-v146/dist/client/_next/static/chunks/
chown -R --reference=app app-v146
chmod -R go-w app-v146

systemctl stop gugemei.service
mv app app-prev-v146
mv app-v146 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v146
  mv app-prev-v146 app
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

