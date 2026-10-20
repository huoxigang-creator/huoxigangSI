#!/usr/bin/env bash
set -e
cd /opt/gugemei
echo "== sha check =="
actual=$(sha256sum gugemei-standalone-v1514.tar.gz | cut -d ' ' -f 1)
echo "actual=$actual"
test "$actual" = "2284838c31e4aeab1f338cb785afb716aa6d1f51159918af7d08e51b1bddcbcb" || { echo "SHA_MISMATCH"; exit 1; }
echo "== unpack =="
rm -rf app-fixed2
mkdir -p app-fixed2
tar -xzf gugemei-standalone-v1514.tar.gz -C app-fixed2
grep -rq "2026-10-17 V-1-5-14" app-fixed2/dist/client/_next/static/chunks/ && echo "version-grep-ok"
echo "== swap =="
chown -R --reference=app app-fixed2
chmod -R go-w app-fixed2
systemctl stop gugemei.service
mv app app-v1514-prev2
mv app-fixed2 app
systemctl start gugemei.service
sleep 3
echo "== verify =="
systemctl is-active gugemei.service
cat app/dist/server/BUILD_ID
echo
curl -s -o /dev/null -w "login_http=%{http_code}\n" http://127.0.0.1:3700/login
echo DONE
