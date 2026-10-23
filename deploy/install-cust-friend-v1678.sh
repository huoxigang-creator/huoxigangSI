#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei/cust-friend
archive=gugemei-standalone-v1678.tar.gz
expected=356811a09d3e1c25bf721c49a8526dc1ff578da61afd0e684208e46c557a3ab7
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
new=app-new-v1678
if [ -d app ]; then
  db_backup="/var/lib/gugemei-cust-friend/backups/gugemei-cust-friend-backup-$(date -u +%Y%m%dT%H%M%SZ)-db.sqlite"
  if [ -f /var/lib/gugemei-cust-friend/gugemei.sqlite ]; then mkdir -p /var/lib/gugemei-cust-friend/backups; cp /var/lib/gugemei-cust-friend/gugemei.sqlite "$db_backup"; echo "db_backup=$db_backup"; fi
fi
rm -rf "$new" app-failed-v1678
mkdir -p "$new"
tar -xzf "$archive" -C "$new"
grep -q "V-1-6-78" -r "$new/dist/client/_next/static/chunks/" || { echo "版本号未找到"; exit 1; }
echo "版本校验通过"
systemctl stop gugemei-cust-friend
if [ -d app ]; then mv app app-prev2-v1678; fi
mv "$new" app
systemctl start gugemei-cust-friend
sleep 3
systemctl is-active gugemei-cust-friend
