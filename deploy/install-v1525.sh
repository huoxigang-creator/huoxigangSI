#!/usr/bin/env bash
# V-1-5-25: ①报价明细「图片」列改「上传附件」，空位只显示+号，图片右下角放大镜点击放大；②「上传识别」移到类别标签「五金费用」后面；③客户确认单手机端附件图片加放大镜放大。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1525.tar.gz
expected=d51be6d5b44428a16fed4e8f98e9d80f85648b66ecfb4ffbad1f1245e1ac5ed7
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1525
test ! -e app-v1525

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1525
tar -xzf "$archive" -C app-v1525
test -f app-v1525/server.js
test -d app-v1525/dist
test -d app-v1525/node_modules
grep -q '2026-10-18 V-1-5-25' -r app-v1525/dist/client/_next/static/chunks/
grep -q 'qwItemPhotoZoom' -r app-v1525/dist/client/_next/static/chunks/
grep -q '上传附件' -r app-v1525/dist/client/_next/static/chunks/
chown -R --reference=app app-v1525
chmod -R go-w app-v1525

systemctl stop gugemei.service
mv app app-prev-v1525
mv app-v1525 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1525
  mv app-prev-v1525 app
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
