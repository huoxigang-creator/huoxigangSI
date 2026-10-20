#!/usr/bin/env bash
# Roll back the v1511 fix to the previous v1511 build (app-prev-v1511a), keeping the v1510 fallback.
set -euo pipefail
cd /opt/gugemei
test -d app-prev-v1511a
test ! -e app-rolledback-v1511
systemctl stop gugemei.service
mv app app-rolledback-v1511
mv app-prev-v1511a app
systemctl start gugemei.service
sleep 2
systemctl is-active gugemei.service
curl --silent --output /dev/null --write-out 'login_http=%{http_code}\n' http://127.0.0.1:3700/login
cat app/dist/server/BUILD_ID; echo
