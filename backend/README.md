# Web Image Uploader Billing API

收费平台后端，沿用 CRM 的 **Node.js 22 + TypeScript + Express + TypeORM + MySQL 8** 分层路线，在宝塔面板用 PM2 + Nginx 部署。

## 已实现

- **分层架构**：`entities / services / routes / middleware / config / utils / payments` 分层，TypeORM `DataSource` 统一管理 11 张表。
- **认证与鉴权**：JWT Bearer 中间件（用户 `auth` + 管理员 `adminAuth`）；开发环境邮箱免密登录 `dev-login`（生产自动关闭）、邮箱+密码注册/登录。
- **权益系统（核心）**：基础免费额度（每月各 1 次）+ 有效订阅套餐配额叠加；`entitlements` 表预扣 / 确认 / 释放，事务保证一致性；下单成功后自动叠加套餐额度，退款自动扣回。
- **计费单元**：一次任务计一次机会（`upload` / `download` / `zip`），由服务端裁决。
- **支付抽象层**：统一 `PaymentProvider` 接口，适配器 `MockProvider` / `AlipayProvider`（RSA2 签名，`alipay.trade.precreate` 二维码 / `wap.pay` 手机网站，异步回调验签、主动查单、连接测试）/ `WeChatProvider`（APIv3，Native / H5 下单，AES-256-GCM 回调解密、主动查单、连接测试）/ `PayPalProvider`（Checkout Orders + Webhook 验签 + 主动查单 + 连接测试）。
- **订单与订阅**：订单状态机（pending / paid / failed / refunded / partially_refunded / expired）、退款、幂等键防重复下单、`webhook_events` 幂等记录、主动查单补给订阅。
- **支付渠道配置**：管理后台表单保存（AES-256-GCM 加密敏感字段，非明文入库），支持「保存」「连接测试」「测试已存配置」。
- **管理后台 API**：仪表盘统计、用户管理（搜索/封禁/发放额度）、套餐 CRUD、订单列表（主动查单/退款）、支付渠道、审计日志、风控规则、系统配置（公告/维护/站点）、ZIP 任务。
- **安全加固**：速率限制、审计日志、维护开关（全局停机）、SSRF 防护（`safeUrl`：拦截 localhost/私网/元数据/危险端口）、图片中转 MIME 与 20MB 限制、15 秒超时。
- **数据库初始化**：`npm run schema` 或 `dist/scripts/init-schema.js` 建 11 表并写入种子（5 套餐 / 3 系统配置 / 3 风控规则）。

## 目录结构

```text
backend/
├── src/
│   ├── config/         # env / logger / database（DataSource）
│   ├── entities/       # User/Plan/Order/Subscription/Entitlement/PaymentChannel/WebhookEvent/ZipJob/AuditLog/SystemConfig/RiskRule
│   ├── middleware/     # auth / adminAuth / errorHandler / rateLimit / audit
│   ├── payments/       # types + mock/alipay/wechat/paypal + index 工厂
│   ├── services/       # AuthService / EntitlementService / BillingService / ZipService / AdminService
│   ├── routes/         # auth / plans / entitlements / billing / zip / proxy / admin
│   ├── scripts/        # init-schema
│   └── app.ts
├── schema.sql          # 建表 + 种子数据
├── .env.example        # 环境变量模板
└── scripts/boot-smoke.sh  # 一键起 MySQL + 后端 + 端到端冒烟
```

## 快速开始（本地）

```bash
cp .env.example .env            # 填 JWT_SECRET、MySQL 凭据、APP_BASE_URL、ADMIN_EMAIL
npm install
npm run build
npm run schema                  # 建库建表 + 种子（或用 npm run dev 走 tsx）
npm run dev                     # 开发：tsx watch
npm start                       # 生产：node dist/app.js
```

`.env` 关键项：`JWT_SECRET`（必须随机且不提交 Git）、`APP_BASE_URL`（用于拼回调地址）、`ADMIN_EMAIL`（被视为管理员）、`NODE_ENV=production`（关闭 dev-login）。

## API 一览（前缀 `/api/v1`）

- `POST /auth/dev-login`（开发）、`POST /auth/register`、`POST /auth/login`、`GET /me`
- `GET /plans`、`GET /entitlements/status`、`POST /entitlements/reserve|commit|release`
- `POST /billing/checkout`、`POST /billing/mock-pay/:orderNo`、`GET /billing/orders`、`GET /billing/orders/:orderNo`、`POST /billing/orders/:orderNo/reconcile`、`POST /billing/refund`、`POST /billing/webhooks/:provider`
- `POST /zip/jobs`、`GET /zip/jobs/:jobNo`、`GET /proxy/fetch`（图片中转，SSRF 防护）
- `GET /admin/dashboard`、`GET/POST/PUT/DELETE /admin/plans`、`GET/PUT /admin/users`、`GET/POST /admin/orders`、`GET/PUT /admin/payment-channels`、`POST /admin/payment-channels/:provider/test|test-saved`、`GET /admin/audit-logs|risk-rules|system-configs`、`PUT /admin/system-configs/:key`
- `DELETE /account`（删除账号关联数据）

## 测试

```bash
npm test                        # 单元测试：支付适配器配置校验 + 回调解析（5 用例）
npm run build && npm run schema # 建库后：
# 起 MySQL + 后端后运行脚本/或直接用 node 命令做端到端冒烟（见 scripts/boot-smoke.sh）
```

## 部署

见 [`../web-image-uploader/docs/宝塔部署文档.md`](../web-image-uploader/docs/宝塔部署文档.md)：宝塔 + PM2 + Nginx，`/api/` 反代到 `127.0.0.1:8787`，上传体限制 ≥25MB，HTTPS 保证 Webhook 可达。真实支付宝/微信/PayPal 密钥通过管理后台「支付渠道」表单配置（加密存储），完成小额沙箱/生产联调后再启用；不得把密钥提交到仓库。
