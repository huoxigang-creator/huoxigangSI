#!/usr/bin/env bash
# V-1-5-40: 瀵煎嚭 Excel 闀挎枃瀛楄嚜鍔ㄦ崲琛屾拺楂樹笉鎴柇锛岃鏍煎瀷鍙峰垪鍔犲锛屽叏琛ㄨ竟妗嗗畬鏁淬€?set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v150.tar.gz
expected=ffc949e692d0851097b936c155f67948b095f11bfcb0931007b41dc1d3946d46
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v150
test ! -e app-v150

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v150
tar -xzf "$archive" -C app-v150
test -f app-v150/server.js
test -d app-v150/dist
test -d app-v150/node_modules
grep -q '2026-10-18 V-1-5-45' -r app-v150/dist/client/_next/static/chunks/
chown -R --reference=app app-v150
chmod -R go-w app-v150

systemctl stop gugemei.service
mv app app-prev-v150
mv app-v150 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v150
  mv app-prev-v150 app
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

