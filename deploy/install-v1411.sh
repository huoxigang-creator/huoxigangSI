#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1411.tar.gz
expected=07d5b24c890d3822accb83438de02af1f1ccd8c418acde34716f539c868447bd
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1410
test ! -e app-v1411

systemctl start gugemei-backup.service
mkdir app-v1411
tar -xzf "$archive" -C app-v1411
test -f app-v1411/server.js
test -d app-v1411/dist
test -d app-v1411/node_modules
chmod -R go-w app-v1411

systemctl stop gugemei.service
mv app app-prev-v1410
mv app-v1411 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1411
  mv app-prev-v1410 app
  systemctl start gugemei.service
  echo 'Deployment failed; previous version restored' >&2
  exit 1
}

systemctl start gugemei.service || rollback
systemctl is-active --quiet gugemei.service || rollback
sleep 2
curl --silent --fail --output /dev/null http://127.0.0.1:3700/login || rollback
curl --silent --output /dev/null --write-out 'login_http=%{http_code}\n' http://127.0.0.1:3700/login
curl --silent --output /dev/null --write-out 'ai_unauthenticated_http=%{http_code}\n' --request POST --header 'Content-Type: application/json' --data '{"question":"测试"}' http://127.0.0.1:3700/api/ai/chat
systemctl is-active gugemei.service
