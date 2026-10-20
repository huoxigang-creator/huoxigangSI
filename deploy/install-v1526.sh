#!/usr/bin/env bash
# V-1-5-26: ①报价明细「上传附件」列 +号移到图片右侧、去框、颜色加深；②撤掉类别标签行的「上传识别」按钮（保留左上角原入口）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1526.tar.gz
expected=3bf8216980ffbfe46c3e910c567d6e590a5c54a7007326a77259fee618c9b67c
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1526
test ! -e app-v1526

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1526
tar -xzf "$archive" -C app-v1526
test -f app-v1526/server.js
test -d app-v1526/dist
test -d app-v1526/node_modules
grep -q '2026-10-18 V-1-5-26' -r app-v1526/dist/client/_next/static/chunks/
if grep -q 'qwTabUploadAction' -r app-v1526/dist/client/_next/static/chunks/; then echo 'unexpected qwTabUploadAction present'; exit 1; fi
chown -R --reference=app app-v1526
chmod -R go-w app-v1526

systemctl stop gugemei.service
mv app app-prev-v1526
mv app-v1526 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1526
  mv app-prev-v1526 app
  systemctl start gugemei.service
  echo 'Deployment failed; previous version restored' >&2
  exit 1
}

systemctl start gugemei.service || rollback
sleep 2
systemctl is-active --quiet gugemei.service || rollback
curl --silent --fail --output /dev/null http://127.0.0.1:3700/login || rollback
curl --silent --output /dev/null --write-out 'login_http=%{http_code}\n' http://127.0.0.1:3700/login
cat app/dist/server/BUILD_ID; echo
systemctl is-active gugemei.service
