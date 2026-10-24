# V-1-7-18 客户建档新增截图识别与语音识别

客户扫码建档页新增两种自动填写方式，与手动填写并存：客户拍照/选图或说一段话，系统自动识别姓名、电话、地址填入表单，客户核对修改后提交建档。

## 截图识别（拍照 / 选图自动识别）

- 扫码建档页新增「拍照 / 选图识别」：客户上传名片、聊天截图、订单照片等，系统调用阿里云 OCR 识别文字，自动提取姓名、电话、地址填入表单。
- 复用项目已有 `lib/aliyun-ocr.ts`（阿里云 OCR）与 `lib/customer-ocr-fields.ts`（六字段解析）。
- 新接口 `app/api/register-ocr/route.ts`（免登录，携带登记链接 token 校验，10MB 内 PNG/JPEG/WebP）。
- 依赖服务器已配置阿里云 OCR 凭证（`/etc/gugemei/ocr.env` 的 ALIYUN_OCR_ACCESS_KEY_ID / SECRET）；未配置时页面给出配置提示。

## 语音识别（录音自动识别）

- 扫码建档页新增「语音识别」：客户点击开始录音，说出姓名、电话、地址，点击停止后自动识别并提取字段填入表单（同时把语音原文放入"装修需求"备注，可删改）。
- 新服务端 `lib/asr.ts`：对接阿里云智能语音交互（ISI）一句话识别 RESTful 接口（`/stream/v1/asr`，X-NLS-Token 认证），Token 通过 POP API CreateToken（HMAC-SHA1 签名）动态获取并缓存。
- 新接口 `app/api/register-speech/route.ts`（免登录，token 校验，2MB/60 秒内 WAV）。
- 前端录音：MediaRecorder 录音 → Web Audio 重采样为 16kHz/16 位/单声道 WAV 后上传；浏览器不支持录音时提示改用截图或手动填写。
- 依赖服务器配置阿里云智能语音交互凭证（`/etc/gugemei/asr.env` 的 ALIYUN_ASR_ACCESS_KEY_ID / ALIYUN_ASR_ACCESS_KEY_SECRET / ALIYUN_ASR_APP_KEY），并需在阿里云控制台开通「智能语音交互」创建项目；未配置时页面给出配置提示。

## 改动文件

- `lib/asr.ts`（新增）：阿里云 ISI 一句话识别 + CreateToken 签名与缓存
- `lib/register-speech.ts`（新增）：从语音转写文本提取姓名/电话/地址
- `app/api/register-ocr/route.ts`（新增）：免登录截图 OCR 识别接口
- `app/api/register-speech/route.ts`（新增）：免登录语音识别接口
- `app/s/r/[token]/register-client.tsx`：新增两种识别入口与录音/转 WAV 逻辑
- `app/api/register-client/route.ts`：修正 GET 校验未 await 的问题（链接校验失败会绕过异常处理）
- `proxy.ts`：放行 `/api/register-ocr`、`/api/register-speech`
- `lib/release.ts`：版本号 V-1-7-18 + 更新日志（并更正 V-1-7-17 发布状态标注）

## 验证

- `npx tsc --noEmit`：通过
- `node scripts/run-framework.mjs build`：通过（含 await 修复后的重跑）
- 未部署线上、未提交 GitHub；OCR/语音识别依赖服务器凭证配置，线上真实识别需在服务器配置 /etc/gugemei/ocr.env 与 asr.env 后验证
