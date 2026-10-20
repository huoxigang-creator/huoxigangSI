# 固美格 V-1-5-64 部署说明

## 更新内容

- 报价明细页右侧改为显示全部空间的项目（不再按左侧选中的空间过滤）
- 标题显示「全部空间」
- 去掉冗余的「空间小计」和「空间合计」
- 版本号进位规则从每 10 次改为每 100 次

## 部署步骤

### 方法一：使用自动部署脚本（推荐）

1. 在本地打开 Git Bash 或终端
2. 进入项目目录：
   ```bash
   cd "E:\新建文件夹\固美格源码_V-1-5-21_20261017"
   ```
3. 运行部署脚本：
   ```bash
   bash deploy-v1564.sh
   ```
4. 脚本会自动：构建 → 打包 → 上传 → 部署 → 验证

### 方法二：手动部署

#### 1. 本地构建

```bash
cd "E:\新建文件夹\固美格源码_V-1-5-21_20261017"
npm run build
```

#### 2. 创建部署包

```bash
cd dist/standalone
tar -czf ../../gugemei-V-1-5-64.tar.gz .
cd ../..
sha256sum gugemei-V-1-5-64.tar.gz
```

记录 SHA256 值用于验证。

#### 3. 上传到 ECS

```bash
scp -P 22 gugemei-V-1-5-64.tar.gz root@8.153.154.4:/tmp/
```

#### 4. 在 ECS 上部署

SSH 登录到 ECS：
```bash
ssh -p 22 root@8.153.154.4
```

执行以下命令：
```bash
# 备份当前版本
rm -rf /opt/gugemei/app-prev2-v1564
cp -a /opt/gugemei/app /opt/gugemei/app-prev2-v1564

# 部署新版本
rm -rf /opt/gugemei/app
mkdir -p /opt/gugemei/app
tar -xzf /tmp/gugemei-V-1-5-64.tar.gz -C /opt/gugemei/app

# 重启服务
systemctl restart gugemei.service

# 验证服务
systemctl status gugemei.service

# 清理临时文件
rm -f /tmp/gugemei-V-1-5-64.tar.gz
```

#### 5. 验证部署

- 访问登录页：http://8.153.154.4:8080/login
- 检查顶部版本号显示为 **V-1-5-64**
- 打开报价明细页，确认右侧显示所有空间的项目

## 回滚

如果部署后出现问题，可以回滚到上一版本：

```bash
ssh -p 22 root@8.153.154.4

# 停止服务
systemctl stop gugemei.service

# 恢复备份
rm -rf /opt/gugemei/app
cp -a /opt/gugemei/app-prev2-v1564 /opt/gugemei/app

# 重启服务
systemctl start gugemei.service
```

## 部署信息

- 版本：V-1-5-64
- 日期：2026-10-19
- ECS 主机：8.153.154.4
- 服务端口：8080
- 回滚目录：/opt/gugemei/app-prev2-v1564
