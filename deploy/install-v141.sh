#!/usr/bin/env bash
# V-1-5-40: 瀵煎嚭 Excel 闀挎枃瀛楄嚜鍔ㄦ崲琛屾拺楂樹笉鎴柇锛岃鏍煎瀷鍙峰垪鍔犲锛屽叏琛ㄨ竟妗嗗畬鏁淬€?set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v141.tar.gz
expected=58198556eb3e4d855703643cba67124d29896a66cb0524bbb0949ac74141b38f
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v141
test ! -e app-v141

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v141
tar -xzf "$archive" -C app-v141
test -f app-v141/server.js
test -d app-v141/dist
test -d app-v141/node_modules
grep -q '2026-10-18 V-1-5-41' -r app-v141/dist/client/_next/static/chunks/
chown -R --reference=app app-v141
chmod -R go-w app-v141

systemctl stop gugemei.service
mv app app-prev-v141
mv app-v141 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v141
  mv app-prev-v141 app
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

