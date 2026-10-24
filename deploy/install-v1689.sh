#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei
archive=gugemei-standalone-v1689.tar.gz
expected=e6fa22be15f4a62259b1c46634c3e7de7a8076fc22e9fef1a55c601e72d26d6b
test "$(sha256sum "$archive" | cut -d ' ' -f 1)" = "$expected"
new=/opt/gugemei/app-new-v1689
previous=/opt/gugemei/app-prev2-v1689
test ! -e "$new"
test ! -e "$previous"
mkdir "$new"
tar -xzf "$archive" -C "$new"
grep -rq 'V-1-6-89' "$new/dist/client/_next/static/chunks/"
grep -rq '冰箱柜' "$new/dist/server/"
/opt/gugemei/runtime/node-v24.20.0-linux-x64/bin/node /opt/gugemei/tools/backup-local.mjs
rollback(){
  echo 'Deployment failed; restoring previous application'
  systemctl stop gugemei || true
  if [ -d /opt/gugemei/app ] && [ -d "$previous" ]; then mv /opt/gugemei/app /opt/gugemei/app-failed-v1689; fi
  if [ -d "$previous" ]; then mv "$previous" /opt/gugemei/app; fi
  systemctl start gugemei
}
trap rollback ERR
systemctl stop gugemei
mv /opt/gugemei/app "$previous"
mv "$new" /opt/gugemei/app
systemctl start gugemei
for i in $(seq 1 15); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3700/login || true)
  if [ "$code" = '200' ]; then break; fi
  sleep 1
done
test "$code" = '200'
systemctl is-active --quiet gugemei
api_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:3700/api/cad-recognition)
test "$api_code" = '401'
trap - ERR
echo "Published V-1-6-89; login=$code; unauthenticated_cad=$api_code"
