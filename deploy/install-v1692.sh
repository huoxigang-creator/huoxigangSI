#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei
archive=gugemei-standalone-v1692.tar.gz
expected=c3cbab1d160296deda7defa7d949c71361b9a2606d476ec89fad2d4e5c5fd2c8
test "$(sha256sum "$archive" | cut -d ' ' -f 1)" = "$expected"
new=/opt/gugemei/app-new-v1692
previous=/opt/gugemei/app-prev2-v1692
test ! -e "$new"
test ! -e "$previous"
mkdir "$new"
tar -xzf "$archive" -C "$new"
grep -rq 'V-1-6-92' "$new/dist/client/_next/static/chunks/"
grep -rq 'account_security' "$new/dist/server/"
/opt/gugemei/runtime/node-v24.20.0-linux-x64/bin/node /opt/gugemei/tools/backup-local.mjs
rollback(){
  echo 'Deployment failed; restoring previous application'
  systemctl stop gugemei || true
  if [ -d /opt/gugemei/app ] && [ -d "$previous" ]; then mv /opt/gugemei/app /opt/gugemei/app-failed-v1692; fi
  if [ -d "$previous" ]; then mv "$previous" /opt/gugemei/app; fi
  systemctl start gugemei
}
python3 /opt/gugemei/configure-security-v1692.py
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
echo "Published V-1-6-92; login=$code; unauthenticated_cad=$api_code"

public_code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/login)
test "$public_code" = '308'
https_code=$(curl -s -o /dev/null -w '%{http_code}' https://www.xn--si-5r5cy60d.com/login)
test "$https_code" = '200'
systemctl show gugemei -p Environment | grep -q 'GUGEMEI_SECURE_COOKIE=true'
echo "HTTPS=$https_code; public HTTP redirect=$public_code; secure sessions enabled"
