#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1624.tar.gz
expected=57ec77b5a71c5e16997cbf32a01dd6805a5e2ea9bc67412d5ee77e5edbb100d8
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"

new=app-new-v1624
if [ -d app ]; then
  db_backup="/var/lib/gugemei/backups/gugemei-backup-$(date -u +%Y%m%dT%H%M%SZ)-db.sqlite"
  if [ -f /var/lib/gugemei/gugemei.sqlite ]; then
    mkdir -p /var/lib/gugemei/backups
    cp /var/lib/gugemei/gugemei.sqlite "$db_backup"
    echo "db_backup=$db_backup"
  fi
fi

rm -rf "$new" app-failed-v1624
mkdir -p "$new"
tar -xzf "$archive" -C "$new"

grep -q "V-1-6-24" -r "$new/dist/client/_next/static/chunks/" || { echo "版本号未找到，部署中止"; exit 1; }

systemctl stop gugemei
if [ -d app ]; then
  if [ -d app-prev2-v1624 ]; then
    echo "app-prev2-v1624 已存在，跳过旧备份"
  else
    mv app app-prev2-v1624
  fi
fi
mv "$new" app
systemctl start gugemei
sleep 3
systemctl is-active gugemei
login_http=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3700/login)
echo "login_http=$login_http"
test "$login_http" = "200"
