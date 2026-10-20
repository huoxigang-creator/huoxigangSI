#!/usr/bin/env bash
# 固美格 V-1-5-64 部署脚本
# 在本地构建并上传到阿里云 ECS

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="V-1-5-64"
DATE="2026-10-19"
BUILD_ID="$(uuidgen 2>/dev/null || echo "build-$(date +%s)")"

# ECS 配置
ECS_HOST="8.153.154.4"
ECS_USER="root"
ECS_PORT="22"
REMOTE_APP_DIR="/opt/gugemei/app"
REMOTE_BACKUP_DIR="/opt/gugemei/app-prev2-v1564"

echo "=========================================="
echo "固美格 ${VERSION} 部署脚本"
echo "日期：${DATE}"
echo "构建 ID: ${BUILD_ID}"
echo "=========================================="

# 1. 本地构建
echo ""
echo "[1/5] 本地构建..."
cd "${PROJECT_DIR}"
npm run build

# 2. 创建部署包
echo ""
echo "[2/5] 创建部署包..."
BUILD_DIR="dist/standalone"
PACKAGE_NAME="gugemei-${VERSION}.tar.gz"

tar -czf "${PACKAGE_NAME}" -C "${BUILD_DIR}" .

# 计算 SHA256
SHA256=$(sha256sum "${PACKAGE_NAME}" | cut -d' ' -f1)
echo "部署包：${PACKAGE_NAME}"
echo "SHA256: ${SHA256}"

# 3. 上传到 ECS
echo ""
echo "[3/5] 上传到阿里云 ECS (${ECS_HOST})..."
scp -P "${ECS_PORT}" "${PACKAGE_NAME}" "${ECS_USER}@${ECS_HOST}:/tmp/${PACKAGE_NAME}"

# 4. 在 ECS 上部署
echo ""
echo "[4/5] 在 ECS 上部署..."
ssh -p "${ECS_PORT}" "${ECS_USER}@${ECS_HOST}" << 'DEPLOY_SCRIPT'
set -euo pipefail

VERSION="V-1-5-64"
PACKAGE_NAME="gugemei-${VERSION}.tar.gz"
REMOTE_APP_DIR="/opt/gugemei/app"
REMOTE_BACKUP_DIR="/opt/gugemei/app-prev2-v1564"

echo "备份当前版本..."
if [ -d "${REMOTE_APP_DIR}" ]; then
  rm -rf "${REMOTE_BACKUP_DIR}"
  cp -a "${REMOTE_APP_DIR}" "${REMOTE_BACKUP_DIR}"
  echo "备份完成：${REMOTE_BACKUP_DIR}"
fi

echo "部署新版本..."
rm -rf "${REMOTE_APP_DIR}"
mkdir -p "${REMOTE_APP_DIR}"
tar -xzf "/tmp/${PACKAGE_NAME}" -C "${REMOTE_APP_DIR}"

echo "重启服务..."
systemctl restart gugemei.service

echo "验证服务..."
sleep 2
if systemctl is-active --quiet gugemei.service; then
  echo "✓ 服务运行正常"
else
  echo "✗ 服务启动失败，正在回滚..."
  rm -rf "${REMOTE_APP_DIR}"
  cp -a "${REMOTE_BACKUP_DIR}" "${REMOTE_APP_DIR}"
  systemctl restart gugemei.service
  echo "已回滚到上一版本"
  exit 1
fi

echo "清理临时文件..."
rm -f "/tmp/${PACKAGE_NAME}"

echo "部署完成！"
DEPLOY_SCRIPT

# 5. 验证
echo ""
echo "[5/5] 验证部署..."
echo "登录页：http://${ECS_HOST}:8080/login"
echo "版本：${VERSION}"

echo ""
echo "=========================================="
echo "部署完成！"
echo "版本：${VERSION}"
echo "SHA256: ${SHA256}"
echo "回滚目录：${REMOTE_BACKUP_DIR}"
echo "=========================================="
