#!/usr/bin/env bash
# 锦木站部署后，自动把公司名替换成锦木的
set -euo pipefail
cd /opt/gugemei/cust-friend/app

# 替换所有chunk文件里的公司名
find dist/client/_next/static/chunks/ -name "*.js" -exec sed -i 's/连云港固美格家具有限公司/连云港锦木全屋定制家居有限公司/g' {} \; 2>/dev/null || true
find dist/client/_next/static/chunks/ -name "*.js" -exec sed -i 's/固美格/锦木/g' {} \; 2>/dev/null || true

echo "锦木公司名替换完成"
