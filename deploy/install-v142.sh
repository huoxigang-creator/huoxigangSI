#!/usr/bin/env bash
# V-1-5-40: 瀵煎嚭 Excel 闀挎枃瀛楄嚜鍔ㄦ崲琛屾拺楂樹笉鎴柇锛岃鏍煎瀷鍙峰垪鍔犲锛屽叏琛ㄨ竟妗嗗畬鏁淬€?set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v142.tar.gz
expected=4f237684f153460579f8a85d4ff530468002b84dd1e6587d288ff9a626894ed4
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v142
test ! -e app-v142

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v142
tar -xzf "$archive" -C app-v142
test -f app-v142/server.js
test -d app-v142/dist
test -d app-v142/node_modules
grep -q '2026-10-18 V-1-5-42' -r app-v142/dist/client/_next/static/chunks/
chown -R --reference=app app-v142
chmod -R go-w app-v142

systemctl stop gugemei.service
mv app app-prev-v142
mv app-v142 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v142
  mv app-prev-v142 app
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

