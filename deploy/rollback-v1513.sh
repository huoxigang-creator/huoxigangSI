#!/usr/bin/env bash
# 回滚到 V-1-5-12。
set -euo pipefail
cd /opt/gugemei
test -d app-prev-v1513
test ! -e app-rolledback-v1513
systemctl stop gugemei.service
mv app app-rolledback-v1513
mv app-prev-v1513 app
systemctl start gugemei.service
sleep 2
systemctl is-active gugemei.service
curl --silent --output /dev/null --write-out 'login_http=%{http_code}\n' http://127.0.0.1:3700/login
cat app/dist/server/BUILD_ID; echo
