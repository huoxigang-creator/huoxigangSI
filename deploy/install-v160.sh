#!/usr/bin/env bash
# V-1-5-60: independent project card "收款" button moved left of "删除项目" and recolored orange
# NOTE: uses app-new-v160 / app-prev2-v160 to avoid colliding with legacy app-prev-v15x dirs (2026-10-15).
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v160.tar.gz
expected=6028db34cb02651dc735165d8b42229e2830af7113cf6ee4d96bb07edfc16c05
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v160
test ! -e app-new-v160

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-new-v160
tar -xzf "$archive" -C app-new-v160
test -f app-new-v160/server.js
test -d app-new-v160/dist
test -d app-new-v160/node_modules
grep -q "2026-10-19 V-1-5-60" -r app-new-v160/dist/client/_next/static/chunks/
grep -q "移到「删除项目」左边" -r app-new-v160/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v160
chmod -R go-w app-new-v160

systemctl stop gugemei.service
mv app app-prev2-v160
mv app-new-v160 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v160
  mv app-prev2-v160 app
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
