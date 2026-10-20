#!/usr/bin/env bash
# V-1-5-40: 瀵煎嚭 Excel 闀挎枃瀛楄嚜鍔ㄦ崲琛屾拺楂樹笉鎴柇锛岃鏍煎瀷鍙峰垪鍔犲锛屽叏琛ㄨ竟妗嗗畬鏁淬€?set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v151.tar.gz
expected=fcdaeb398ff2f73ccf96b46913e848a47aa9b7f16ef557cf81bca59785649694
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v151
test ! -e app-v151

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v151
tar -xzf "$archive" -C app-v151
test -f app-v151/server.js
test -d app-v151/dist
test -d app-v151/node_modules
grep -q '2026-10-18 V-1-5-45' -r app-v151/dist/client/_next/static/chunks/
chown -R --reference=app app-v151
chmod -R go-w app-v151

systemctl stop gugemei.service
mv app app-prev-v151
mv app-v151 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v151
  mv app-prev-v151 app
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

