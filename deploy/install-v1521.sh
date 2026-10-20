#!/usr/bin/env bash
# V-1-5-21: ①五金费用栏去掉"下载导入模板"，改为"全部料单导入"（一次选择文件夹内所有料单表格并汇总导入）；②添加明细/上传识别/删除移到"导入五金Excel/CSV"后，打印A4/查看利润移到标题行；③新建项目报价左侧与客户报价一致（整户报价总额+房间列表+添加房间）。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1521.tar.gz
expected=63a11d09afc71f51a4f39d0798a96b02e664c8a2e292c9e4f2f892cb569415d9
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1521
test ! -e app-v1521

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1521
tar -xzf "$archive" -C app-v1521
test -f app-v1521/server.js
test -d app-v1521/dist
test -d app-v1521/node_modules
grep -q '2026-10-18 V-1-5-21' -r app-v1521/dist/client/_next/static/chunks/
grep -q '全部料单导入' -r app-v1521/dist/client/_next/static/chunks/
grep -q 'webkitdirectory' -r app-v1521/dist/client/_next/static/chunks/
chown -R --reference=app app-v1521
chmod -R go-w app-v1521

systemctl stop gugemei.service
mv app app-prev-v1521
mv app-v1521 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1521
  mv app-prev-v1521 app
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
