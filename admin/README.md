# Web Image Uploader 管理后台

Vue 3 + TypeScript + Element Plus + Pinia + Vue Router 的收费平台管理后台，默认从 `http://localhost:8787` 读取收费 API。

## 页面模块

- **登录**：管理员 JWT 登录（开发环境 `dev-login` 免密；生产用邮箱+密码）。
- **仪表盘**：套餐数 / 订单数 / 已支付订单 / 累计营收 + 套餐表格。
- **用户管理**：邮箱搜索、账号状态切换（active/blocked/deleted）、发放额度。
- **套餐管理**：套餐 CRUD（价格、计费周期、上传/下载/ZIP 额度、并发、试用期、退款策略等）。
- **订单管理**：订单列表、主动查单（reconcile）、退款。
- **支付渠道**：Mock / 支付宝 / 微信 / PayPal 四渠道表单配置（敏感字段加密存储）、「测试连接」（校验必填 + 沙箱/生产联调提示）、「测试已存配置」。
- **中转与 ZIP 任务**：服务端抓取/打包任务监控（数据由 `zip_jobs` 接口承载）。
- **审计日志**：谁、何时、对哪个对象做了什么、改前后值。
- **风控规则**：注册/接口/任务限流规则查看与调整。
- **系统配置**：公告、维护开关（停机）、站点信息。

## 运行

```bash
npm install
npm run dev      # vitest / vite 开发
npm run build    # 生产构建，产物在 dist/
```

## 指向收费 API

默认 `http://localhost:8787`。生产请在浏览器控制台或代码里设置：

```js
localStorage.setItem('pgx_api_base', 'https://你的收费API域名')
```

## 路由

采用 hash 路由（`createWebHashHistory`），部署到任意静态站即可，无需服务端路由配置。访问未登录页面会自动跳到登录页；已登录访问登录页自动跳仪表盘。

## 备注

管理员账号由后端 `ADMIN_EMAIL` 指定（`dev-login` / 密码登录均视为管理员）。开发登录接口仅在后端 `NODE_ENV` 非 production 时可用，生产环境必须配置管理员密码登录。
