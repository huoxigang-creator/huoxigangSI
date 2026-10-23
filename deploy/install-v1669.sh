#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei
archive=gugemei-standalone-v1669.tar.gz
expected=81e54a73dd662fec918b6904e2863d251763229d4b336a3a983fcd2189f3a585
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
new=app-new-v1669
if [ -d app ]; then
  db_backup="/var/lib/gugemei/backups/gugemei-backup-$(date -u +%Y%m%dT%H%M%SZ)-db.sqlite"
  if [ -f /var/lib/gugemei/gugemei.sqlite ]; then mkdir -p /var/lib/gugemei/backups; cp /var/lib/gugemei/gugemei.sqlite "$db_backup"; echo "db_backup=$db_backup"; fi
fi
rm -rf "$new" app-failed-v1669
mkdir -p "$new"
tar -xzf "$archive" -C "$new"
grep -q "V-1-6-69" -r "$new/dist/client/_next/static/chunks/" || { echo "版本号未找到"; exit 1; }
grep -rq "©2020连云港固美格家具有限公司 版权所有" "$new/dist/client/_next/static/chunks/" || { echo "固美格版权校验失败"; exit 1; }
echo "固美格校验通过"
systemctl stop gugemei
if [ -d app ]; then mv app app-prev2-v1669; fi
mv "$new" app
systemctl start gugemei
sleep 3
systemctl is-active gugemei
login_http=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3700/login)
echo "login_http=$login_http"
test "$login_http" = "200"
