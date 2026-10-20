#!/usr/bin/env bash
# Return to V-1-5-10. Code only: the database is untouched (V-1-5-11 made no schema-breaking changes; phone/sms tables are additive).
set -euo pipefail
cd /opt/gugemei
test -d app-prev-v1510
test ! -e app-rolledback-v1511
systemctl stop gugemei.service
mv app app-rolledback-v1511
mv app-prev-v1510 app
systemctl start gugemei.service
sleep 2
systemctl is-active gugemei.service
curl --silent --output /dev/null --write-out 'login_http=%{http_code}\n' http://127.0.0.1:3700/login
cat app/dist/server/BUILD_ID; echo
