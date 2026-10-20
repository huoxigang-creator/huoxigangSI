#!/usr/bin/env bash
# V-1-5-33: 成品五金段内排序细化——铰链置顶、三节轨/三节抽按规格升序、带「轮」字聚一起、其余按名称；「L型柜体免拉手封口ZP」不再导入。
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v1533.tar.gz
expected=75287ff2609e6c984ef8d2721b44b719a86adba6b52c1546f0270522b7e3f76b
actual=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev-v1533
test ! -e app-v1533

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-v1533
tar -xzf "$archive" -C app-v1533
test -f app-v1533/server.js
test -d app-v1533/dist
test -d app-v1533/node_modules
grep -q '2026-10-18 V-1-5-33' -r app-v1533/dist/client/_next/static/chunks/
grep -q 'L型柜体免拉手封口ZP' -r app-v1533/dist/client/_next/static/chunks/
chown -R --reference=app app-v1533
chmod -R go-w app-v1533

systemctl stop gugemei.service
mv app app-prev-v1533
mv app-v1533 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v1533
  mv app-prev-v1533 app
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
