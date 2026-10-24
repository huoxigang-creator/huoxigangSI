# V-1-6-90 CAD上传大小修复

原因：公网nginx默认请求体限制为1MB。用户DXF原始8815153字节，base64 JSON约11.8MB，被返回HTML格式413，前端直接response.json导致Unexpected token '<'。

修复：仅为固美格HTTP8080及HTTPS站点的/api/cad-recognition配置29m请求体上限，匹配应用20MB原始文件上限及base64膨胀；保留既有代理头、来源处理、认证和其他接口限制。配置备份位于/opt/gugemei/nginx-backups-v1690，nginx -t通过并平滑reload。客户端对非JSON的413、登录跳转和网关异常显示中文提示。

验证：27项相关测试及生产构建通过。通过HTTP和HTTPS实际发送11754073字节的测试JSON，均返回应用401 JSON（未登录），证明大请求已通过nginx、认证仍保留；测试未读取或写入用户业务记录。发布后服务active、登录页200、未登录CAD接口401。真实DXF的柜体解析仍通过此前样本回归测试；没有代用户在真实报价中加入明细。

部署：V-1-6-90，2026-10-24（北京时间）。
包：gugemei-standalone-v1690.tar.gz
SHA256：f5e61d8e052c08e02c5aa534ed82d781f06195787cef84790e6019bfb27e7d9e
