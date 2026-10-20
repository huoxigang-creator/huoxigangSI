#!/usr/bin/env bash
# V-1-5-16: 客户确认单升级——报价页"客户确定"入口、已采纳报价自动候选、客户签名横屏全屏、签名后下载含签名报价单(PDF)、有效期永久、确认内容手动填写、确认事项上传文件与图片。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1516.tar.gz
expected=f66ead66b0cc3fcd737c87c1bbf3a1c63845ac765b3fbe1ac5db0fb1ca3ed552
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1516
test ! -e app-v1516

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1516
tar -xzf "$archive" -C app-v1516
test -f app-v1516/server.js
test -d app-v1516/dist
test -d app-v1516/node_modules
grep -q '2026-10-17 V-1-5-16' -r app-v1516/dist/client/_next/static/chunks/
chown -R --reference=app app-v1516
chmod -R go-w app-v1516

systemctl stop gugemei.service
mv app app-prev-v1516
mv app-v1516 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1516
  mv app-prev-v1516 app
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
