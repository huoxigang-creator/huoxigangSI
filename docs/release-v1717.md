# V-1-7-17 客户扫码自助建档

我的客户页新增"扫码建档"：生成二维码发给客户，客户扫码填写姓名、电话、地址并提交，系统自动建立客户档案（自动生成 SID 客户编号），同手机号自动合并到已有档案、不重复建档；支持抖音/朋友圈/门店/老客户转介绍等来源渠道，扫码提交时自动打来源标签，便于统计引流效果。

## 改动文件

- `lib/register-links.ts`（新增）：登记链接生成、校验与建档提交；链接存 records（kind=`register_link`），有效期一年；建档复用现有 create_project 编号生成逻辑，合并时只补充地址/备注/来源，不覆盖已有资料
- `app/api/register-link/route.ts`（新增）：登录态生成登记链接（管理端二维码用）
- `app/api/register-client/route.ts`（新增）：免登录校验链接（GET）与提交建档（POST），带 origin 跨站与请求体大小防护
- `app/s/r/[token]/page.tsx`、`app/s/r/[token]/register-client.tsx`（新增）：手机端扫码填表页，姓名/电话必填、地址必填、需求备注选填，提交后显示客户编号
- `app/register-qr-dialog.tsx`（新增）：管理端二维码弹窗，渠道选择、二维码展示、链接复制、刷新
- `app/manager.tsx`：我的客户页工具栏新增"扫码建档"按钮
- `proxy.ts`：放行 `/api/register-client` 与 `/s/r/` 扫码路径（免登录）
- `lib/release.ts`：版本号 V-1-7-17 + 更新日志

附带修复：`app/api/customer-ocr/route.ts` 两处 import 路径多写一级 `..`（`../../../../lib/` → `../../../lib/`），导致整个项目构建失败；仅修正路径深度，不改功能逻辑（该文件为并行开发中未提交功能）。

## 验证

- `node scripts/run-framework.mjs build`：5 阶段全部通过，生成 dist/standalone
- `npx tsc --noEmit`：通过
- 未部署线上、未提交 GitHub（本批存在并行未提交代码，发布时需按项目流程统一提交与部署后再补线上验证）

构建包待生成：gugemei-standalone-v1717.tar.gz。
