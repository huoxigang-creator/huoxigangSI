# 账号找回与程序员维护

## 用户设置

使用原密码登录，打开顶栏“个人设置”，在“找回密码安全问题”填写问题、答案、再次确认答案与当前登录密码。问题4–100字符，答案4–200字符，答案不应使用生日等公开信息。

答案只保存随机盐和scrypt摘要，不回显。设置或修改问题会使其他旧会话失效，当前浏览器获得新会话。不要把真实答案写进源码、GitHub、聊天或运维文档。

短信登录与找回密码均采用两步：先验证短信，再回答本人预先设置的问题。一次性验证凭证5分钟有效、绑定账号密码版本和用途；答错5次暂停验证15分钟。未设置问题的账号仍能使用原密码登录，但不能单凭短信登录或重置密码。

若手机丢失且该手机上原本已经登录，应尽快在可信设备修改密码以使旧会话失效；安全问题本身不能代替遗失设备上的会话撤销。

## 程序员/服务器管理员恢复

没有网页万能密码、固定答案或源码口令。维护者必须拥有服务器SSH/操作系统权限，才能读取并修改指定本地账号库。

维护脚本：`scripts/reset-account-password.mjs`；服务器部署副本：`/opt/gugemei/reset-account-password.mjs`。新密码仅从stdin读取，不写在命令参数中。

管理员在服务器交互终端执行（将USERNAME替换为实际账号；不要在聊天中提供密码）：

```bash
read -r -s -p '新密码（至少12位）: ' recovery_password
printf '\n'
printf '%s' "$recovery_password" | sudo -u gugemei env GUGEMEI_DATA_DIR=/var/lib/gugemei /opt/gugemei/runtime/node-v24.20.0-linux-x64/bin/node /opt/gugemei/reset-account-password.mjs USERNAME --clear-security-question
unset recovery_password
```

`--clear-security-question`会在同一事务中清除该账号遗忘的安全问题及找回凭证，重设密码使旧登录失效。去掉此选项则保留原安全问题。用户用新密码登录后自行重新设置问题。

只操作账号与账号安全表，不删除、恢复或修改项目及收付款记录。恢复前应核验申请人的身份，执行现有备份，并按组织权限管理SSH访问。
