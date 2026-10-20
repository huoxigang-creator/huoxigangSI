#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1410.tar.gz
expected=7ae82e81429855c99a841be26badf50d6f3220ddf9fb34751e35f2ca0ccf2f32
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v149
test ! -e app-v1410

systemctl start gugemei-backup.service
mkdir app-v1410
tar -xzf "$archive" -C app-v1410
test -f app-v1410/server.js
test -d app-v1410/dist
test -d app-v1410/node_modules
chmod -R go-w app-v1410

systemctl stop gugemei.service
mv app app-prev-v149
mv app-v1410 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1410
  mv app-prev-v149 app
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
