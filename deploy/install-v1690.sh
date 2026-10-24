#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei
archive=gugemei-standalone-v1690.tar.gz
expected=f5e61d8e052c08e02c5aa534ed82d781f06195787cef84790e6019bfb27e7d9e
test "$(sha256sum "$archive" | cut -d ' ' -f 1)" = "$expected"
new=/opt/gugemei/app-new-v1690
previous=/opt/gugemei/app-prev2-v1690
test ! -e "$new"
test ! -e "$previous"
mkdir "$new"
tar -xzf "$archive" -C "$new"
grep -rq 'V-1-6-90' "$new/dist/client/_next/static/chunks/"
grep -rq '冰箱柜' "$new/dist/server/"
/opt/gugemei/runtime/node-v24.20.0-linux-x64/bin/node /opt/gugemei/tools/backup-local.mjs
rollback(){
  echo 'Deployment failed; restoring previous application'
  systemctl stop gugemei || true
  if [ -d /opt/gugemei/app ] && [ -d "$previous" ]; then mv /opt/gugemei/app /opt/gugemei/app-failed-v1690; fi
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
echo "Published V-1-6-90; login=$code; unauthenticated_cad=$api_code"
