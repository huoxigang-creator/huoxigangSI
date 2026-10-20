#!/usr/bin/env bash
# Return to V-1-5-9. Code only: the database is untouched (V-1-5-10 made no schema changes).
set -euo pipefail
cd /opt/gugemei
test -d app-prev-v159
test ! -e app-rolledback-v1510
systemctl stop gugemei.service
mv app app-rolledback-v1510
mv app-prev-v159 app
systemctl start gugemei.service
sleep 2
systemctl is-active gugemei.service
curl --silent --output /dev/null --write-out 'login_http=%{http_code}\n' http://127.0.0.1:3700/login
cat app/dist/server/BUILD_ID; echo
