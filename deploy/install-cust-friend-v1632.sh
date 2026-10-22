#!/usr/bin/env bash
set -euo pipefail
cd /opt/gugemei/cust-friend

archive=gugemei-standalone-v1632.tar.gz
expected=425ad16a069221a787e99f88d4bffa32b2fa68a6a19e6c13883fbd6381423c8b
actual=$(sha256sum "$archive" | cut -d " " -f 1)
test "$actual" = "$expected"

new=app-new-v1632
rm -rf "$new" app-failed-v1632 app-prev2-v1632
mkdir -p "$new"
tar -xzf "$archive" -C "$new"

grep -q "V-1-6-32" -r "$new/dist/client/_next/static/chunks/" || { echo "版本号未找到，部署中止"; exit 1; }

# 品牌替换：连云港固美格家具有限公司 -> 连云港锦木全屋定制家居有限公司，其余 固美格 -> 锦木
# 登录页版权差异化：年份 ©2020 -> ©2025，删除“版权所有”
find "$new/dist" "$new/public" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' -o -name '*.txt' -o -name '*.md' \) -exec sed -i 's/连云港固美格家具有限公司/连云港锦木全屋定制家居有限公司/g; s/固美格/锦木/g; s/©2020/©2025/g; s/ 版权所有//g' {} +
sed -i 's/连云港固美格家具有限公司/连云港锦木全屋定制家居有限公司/g; s/固美格/锦木/g; s/©2020/©2025/g; s/ 版权所有//g' "$new/server.js"

# 品牌残留校验
if find "$new/dist" "$new/public" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' -o -name '*.svg' -o -name '*.txt' -o -name '*.md' \) -exec grep -l '固美格' {} + 2>/dev/null | head -1 | grep -q .; then
  echo "固美格残留，部署中止"; exit 1
fi
grep -q '锦木全屋定制家居有限公司' "$new/dist/client/_next/static/chunks/"*.js 2>/dev/null || { echo "锦木品牌校验失败，部署中止"; exit 1; }
grep -rq "©2025连云港锦木全屋定制家居有限公司" "$new/dist/client/_next/static/chunks/" || { echo "锦木©2025校验失败，部署中止"; exit 1; }
if grep -rq '©2025连云港锦木全屋定制家居有限公司 版权所有' "$new/dist/client/_next/static/chunks/" 2>/dev/null; then
  echo "锦木版权所有残留，部署中止"; exit 1
fi
echo "品牌替换与版权差异化校验通过"

systemctl stop gugemei-cust-friend
if [ -d app ]; then
  mv app app-prev2-v1632
fi
mv "$new" app
systemctl start gugemei-cust-friend
sleep 3
systemctl is-active gugemei-cust-friend
login_http=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3710/login)
echo "login_http=$login_http"
test "$login_http" = "200"
