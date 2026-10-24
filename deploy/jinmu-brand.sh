#!/usr/bin/env bash
# 锦木站部署后，自动把公司名替换成锦木的
set -euo pipefail
cd /opt/gugemei/cust-friend/app

# 替换所有js文件里的"固美格"为"锦木"（client + server 都要）
find dist/ -name "*.js" -exec sed -i 's/固美格/锦木/g' {} \; 2>/dev/null || true

echo "锦木公司名替换完成"
