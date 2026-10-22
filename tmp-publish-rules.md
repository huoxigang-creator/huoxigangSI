# 发布流程规则

## 发布前检查
1. 版本号（lib/release.ts 的 SOFTWARE_VERSION）已递增
2. CHANGELOG 顶部已补本次更新记录
3. 更新记录里注明"阿里云服务器与 GitHub 均已上传同步"
4. 先查 rules/ 规则库，确认排版等业务规则没遗漏

## 发布后
1. 明确告诉用户本次发布的版本号
2. 确认阿里云服务 active、login_http=200
3. 确认 GitHub 已 push 成功

## 排版规则
- 宏光排版前先查 rules/排版规则库（小板优先/聚拢原则）
- 按规则排版，不凭记忆
