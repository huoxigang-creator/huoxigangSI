# 固美格 V-1-5-65 部署包

## 更新内容

1. **V-1-5-64**：报价明细页显示全部空间项目，版本号进位规则改为 100 次
2. **V-1-5-65**：客户报价用销售价，内部报价用采购价

## 部署步骤

### 1. 在本机构建

打开 Git Bash 或 PowerShell：

```powershell
cd "E:\新建文件夹\固美格源码_V-1-5-21_20261017"
npm run build
```

### 2. 创建部署包

```powershell
cd dist\standalone
tar -czf ..\..\gugemei-V-1-5-65.tar.gz .
cd ..\..
```

### 3. 上传到阿里云 ECS

```powershell
scp -P 22 gugemei-V-1-5-65.tar.gz root@8.153.154.4:/tmp/
```

### 4. SSH 登录并部署

```powershell
ssh -p 22 root@8.153.154.4
```

在 ECS 上执行：

```bash
# 备份当前版本
rm -rf /opt/gugemei/app-prev2-v1565
cp -a /opt/gugemei/app /opt/gugemei/app-prev2-v1565

# 部署新版本
rm -rf /opt/gugemei/app
mkdir -p /opt/gugemei/app
tar -xzf /tmp/gugemei-V-1-5-65.tar.gz -C /opt/gugemei/app

# 重启服务
systemctl restart gugemei.service

# 验证服务
systemctl status gugemei.service

# 清理临时文件
rm -f /tmp/gugemei-V-1-5-65.tar.gz
```

### 5. 验证部署

- 访问：http://8.153.154.4:8080/login
- 检查版本号：**V-1-5-65**
- 测试报价功能：
  - 客户项目报价：从材料库选择应显示销售价
  - 合作项目报价：从材料库选择应显示采购价

## 回滚

```bash
ssh -p 22 root@8.153.154.4

systemctl stop gugemei.service
rm -rf /opt/gugemei/app
cp -a /opt/gugemei/app-prev2-v1565 /opt/gugemei/app
systemctl start gugemei.service
```

## 部署信息

- 版本：V-1-5-65
- 日期：2026-10-19
- ECS：8.153.154.4:8080
- 回滚目录：/opt/gugemei/app-prev2-v1565
