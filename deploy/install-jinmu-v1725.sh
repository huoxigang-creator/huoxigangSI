#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei/cust-friend
new=/opt/gugemei/cust-friend/app-new-v1725
previous=/opt/gugemei/cust-friend/app-prev-brand-v1725
test -d "$new"
test -x /opt/gugemei/tools/dwg2dxf-limited
test ! -e "$previous"
grep -rq '©2025连云港锦木全屋定制家居有限公司' "$new/dist/client/"
grep -rq 'V-1-7-25' "$new/dist/client/"
python3 /opt/gugemei/preserve-static-assets.py /opt/gugemei/cust-friend/app "$new"
GUGEMEI_DATA_DIR=/var/lib/gugemei-cust-friend /opt/gugemei/runtime/node-v24.20.0-linux-x64/bin/node /opt/gugemei/tools/backup-local.mjs
python3 /opt/gugemei/cust-friend/configure-jinmu-v172.py
rollback(){
 systemctl stop gugemei-cust-friend || true
 if [ -d "$previous" ]; then
  if [ -d /opt/gugemei/cust-friend/app ]; then mv /opt/gugemei/cust-friend/app /opt/gugemei/cust-friend/app-failed-brand-v1725; fi
  mv "$previous" /opt/gugemei/cust-friend/app
 fi
 systemctl start gugemei-cust-friend
}
trap rollback ERR
systemctl stop gugemei-cust-friend
mv app "$previous"
mv "$new" app
systemctl start gugemei-cust-friend
for i in $(seq 1 20); do
 if curl -fs http://127.0.0.1:3710/login -o /tmp/jinmu-login-v1725.html; then break; fi
 sleep 1
done
grep -q '©2025连云港锦木全屋定制家居有限公司' /tmp/jinmu-login-v1725.html
if grep -q '固美格' /tmp/jinmu-login-v1725.html; then exit 1; fi
systemctl is-active --quiet gugemei-cust-friend
curl -fs https://jm.xn--si-5r5cy60d.com/login -o /tmp/jinmu-public-v1725.html
grep -q '©2025连云港锦木全屋定制家居有限公司' /tmp/jinmu-public-v1725.html
trap - ERR
echo 'Jinmu independent service published; full company brand verified; data directory unchanged'
