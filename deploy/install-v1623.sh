#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1623.tar.gz
expected=8c17dc4798fba1110413724acf9321ecdbd09d7df96cd955ce57893f14e65814
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"

new=app-new-v1623
if [ -d app ]; then
  db_backup="/var/lib/gugemei/backups/gugemei-backup-$(date -u +%Y%m%dT%H%M%SZ)-db.sqlite"
  if [ -f /var/lib/gugemei/gugemei.sqlite ]; then
    mkdir -p /var/lib/gugemei/backups
    cp /var/lib/gugemei/gugemei.sqlite "$db_backup"
    echo "db_backup=$db_backup"
  fi
fi

rm -rf "$new" app-failed-v1623
mkdir -p "$new"
tar -xzf "$archive" -C "$new"

grep -q "V-1-6-23" -r "$new/dist/client/_next/static/chunks/" || { echo "版本号未找到，部署中止"; exit 1; }

systemctl stop gugemei
if [ -d app ]; then
  if [ -d app-prev2-v1623 ]; then
    echo "app-prev2-v1623 已存在，跳过旧备份"
  else
    mv app app-prev2-v1623
  fi
fi
mv "$new" app
systemctl start gugemei
sleep 2
systemctl is-active gugemei
login_http=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login)
echo "login_http=$login_http"
test "$login_http" = "200"
