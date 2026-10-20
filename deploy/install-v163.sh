#!/usr/bin/env bash
# V-1-5-63: fix quote save "报价不能移动到其他项目" when editing child quote from parent workspace
#   openDraft edit/version/copy now locks targetProjectId to quote.project
# NOTE: uses app-new-v163 / app-prev2-v163 to avoid colliding with legacy app-prev-v15x dirs (2026-10-15).
set -euo pipefail
cd /opt/gugemei

archive=gugemei-standalone-v163.tar.gz
expected=c626299b645c37afda8729f96e00f0d10fb57aeb72a1e96492db68e6b89738cb
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"
test -d app
test ! -e app-prev2-v163
test ! -e app-new-v163

before=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
systemctl start gugemei-backup.service
after=$(ls -1 /var/lib/gugemei/backups/*-db.sqlite 2>/dev/null | wc -l)
test "$after" -gt "$before"
echo "db_backup=$(ls -1t /var/lib/gugemei/backups/*-db.sqlite | head -1)"

mkdir app-new-v163
tar -xzf "$archive" -C app-new-v163
test -f app-new-v163/server.js
test -d app-new-v163/dist
test -d app-new-v163/node_modules
grep -q "2026-10-19 V-1-5-63" -r app-new-v163/dist/client/_next/static/chunks/
chown -R --reference=app app-new-v163
chmod -R go-w app-new-v163

systemctl stop gugemei.service
mv app app-prev2-v163
mv app-new-v163 app

rollback() {
  systemctl stop gugemei.service || true
  mv app app-failed-v163
  mv app-prev2-v163 app
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
