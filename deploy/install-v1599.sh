#!/usr/bin/env bash
# V-1-5-99: 采购单新增"扫描识别"按钮，豆包自动识别图片明细并添加到表格。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1599.tar.gz
expected=f26b4c3bc90a6ca1ca34846ac2a2315b78156c21415a76a43366720b7049b394
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v1599
test ! -e app-new-v1599

before=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
systemctl start gugemei-backup.service
after=$(ls -1t /var/lib/gugemei/backups/*-report.json 2>/dev/null | sed -n '1p')
test -n "$after"
test "$after" != "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | sed -n '1p')"

mkdir app-new-v1599
tar -xzf "$archive" -C app-new-v1599
test -f app-new-v1599/server.js
test -d app-new-v1599/dist
test -d app-new-v1599/node_modules
grep -q "2026-10-21 V-1-5-99" -r app-new-v1599/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v1599
chmod -R go-w app-new-v1599

systemctl stop gugemei.service
mv app app-prev2-v1599
mv app-new-v1599 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1599
  mv app-prev2-v1599 app
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
