# 网页图片上传器 · Web Image Uploader（Chrome 扩展）

Chrome Manifest V3 扩展：扫描当前网页图片 → 筛选并预览 → 批量上传到 Google Photos，或下载选中图片/ZIP 压缩包。支持任务进度、失败重试、断点续传和多种网页图片来源。

> 需求与可行性分析见仓库根目录 `../Google-Photos-Image-Uploader-需求文档.md`。

> 商业化、额度、支付渠道、管理后台和审核要求见 [`docs/收费模式需求文档.md`](docs/收费模式需求文档.md)；收费开发前基线备份见 [`docs/当前开发备份-2026-09-04.md`](docs/当前开发备份-2026-09-04.md)。

> **收费系统已完整落地**：后端（Node/TS/Express + TypeORM + MySQL 8）与 Vue 管理后台见同级目录 `../backend/` 与 `../admin/`（与扩展平级）；扩展端已接入额度预扣/确认/退回与升级入口（详见「收费与会员」）。

## 功能一览

- **网页扫描**：`img` / `srcset` / `picture` / 懒加载 `data-src` 系列 / CSS `background-image` / 指向图片的外链 `<a>`；MutationObserver 增量捕捉滚动加载的新图。
- **高清选择**：按像素面积 + URL 关键词综合评分选最佳地址；疑似缩略图自动套用重写规则找原图（去尺寸参数、去缩略路径段、googleusercontent `=s1600` → `=s0`）；候选地址可手动切换；重复图片标灰。
- **选择操作**：全选 / 清空 / 反选 / 仅高清；按分辨率排序、关键词筛选、查看原图、复制地址。
- **上传**：单个或批量（上限 500 张/任务，可调）；相册自动新建（`网页图片-域名-日期` 模板）或选择本扩展曾创建的相册（Google API 政策限制，无法写入手工相册）。
- **下载**：下载选中图片到指定文件夹；ZIP 下载将选中图片一次打包并自动命名。严格防盗链站点可能只能使用 Chrome 原生下载，无法被扩展读取后打包。
- **进度 UI**：三页签（图片选择 / 上传任务 / 历史记录）；总体进度、当前文件名、阶段、成功/失败/跳过/取消统计、失败原因、单项与整批重试。
- **可靠性**：并发 1-4 可调、指数退避重试（默认 2 次）、429/5xx 自动重试、401 暂停并引导重授权、Popup 关闭任务继续、SW 重启断点恢复、SHA-256 本地去重。
- **权限克制**：默认仅 `storage/identity/scripting/alarms/activeTab`；跨域直连为**可选** `<all_urls>` 权限，首用时可一键授权或放弃（自动走页面上下文抓取）。
- **右键菜单**：网页空白处右键「扫描本页图片并批量上传…」直接进入图片选择；图片/图片链接上右键可「上传图片到 Google 相册（高清优先）」或「复制候选原图地址」（自动套用缩略图→原图重写规则）。上传后自动弹出进度窗口，工具栏角标显示进行中任务数。
- **收费与会员（Phase 1 已落地）**：设置页可配置收费后端地址并开启「配额校验」；上传前向产品账号预扣一次额度，任务成功确认、失败/取消退回；弹窗顶部展示本月剩余额度，额度用尽时一键升级（登录产品账号 → 选套餐 → 下单）。支持支付宝 / 微信支付 / PayPal 三渠道（管理后台表单配置 + 连接测试 + 沙箱/生产回调）。

## 目录结构

```text
（三个项目平级，位于同一仓库根目录下）

web-image-uploader/            ← Chrome 扩展
├── manifest.json
├── icons/                  # 16/32/48/128 PNG
├── src/
│   ├── background/         # service-worker, auth-manager, photos-client, downloader, upload-manager, task-store
│   ├── content/            # scanner, page-bridge, main-fetcher（MAIN world 抓取）
│   ├── shared/             # constants, utils, srcset, urls, scoring, validators, billing-api（纯函数，可单测）
│   ├── popup/              # popup.html/css/js（含会员/额度栏与升级弹层）
│   └── options/            # options.html/css/js（含「收费与会员」设置项）
├── scripts/                # make_icons.py, check-syntax.js
├── tests/run-tests.js      # npm test
└── docs/                   # 收费需求、宝塔部署、验收报告、合规文案

../backend/                  ← 收费后端（Node/TS/Express + TypeORM + MySQL 8）
../admin/                    ← 管理后台（Vue 3/Element Plus/Pinia/Vue Router）
```

## 快速开始（开发者模式）

1. **加载扩展**
   `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选择本目录 `web-image-uploader`。
2. **Google Cloud 配置（一次性）**
   1. console.cloud.google.com 新建项目；
   2. 启用 **Photos Library API**；
   3. 「OAuth consent screen」选 External，把本人 Gmail 加入测试用户（保持 Testing 即可）；
   4. 「凭据 → 创建凭据 → OAuth 客户端 ID → Chrome 扩展程序」，填当前扩展 ID（扩展页可查）；
   5. 打开插件「设置」页，粘贴 Client ID，保存。
   > 注意：Testing 状态下刷新令牌约 7 天过期，届时重新登录一次即可；正式使用需走 Google OAuth 验证。
3. **试用（Mock 模式，无需真实授权）**
   设置页打开「Mock 模式」→ 回到任意图集网页 → 点插件图标 → 「扫描图片」→ 勾选若干张 → 「上传选中图片」，可在「上传任务」观察完整流程（模拟下载/上传/相册）。
4. **真实使用**：设置页关闭 Mock → 点弹窗右上角 👤 登录 → 选网页图片 → 上传。
5. **收费/会员联调**：先启动收费后端（见 [`docs/宝塔部署文档.md`](docs/宝塔部署文档.md) 或 `../backend/README.md`），在设置页「收费与会员」填入后端地址并开启「配额校验」，点「测试连接」验证可达；随后在弹窗点「登录」用产品账号（开发环境可用任意邮箱免密登录）绑定，上传即开始计入额度。

## 开发命令

```bash
# 扩展（根目录）
npm test          # 单元测试（29 用例）
npm run check     # 全量 JS 语法检查 + manifest 引用校验
npm run icons     # 重新生成图标（Python3 标准库）

# 收费后端（../backend/）
npm run build     # tsc 编译到 dist
npm test          # 支付适配器等单元测试（5 用例）
npm run schema    # 初始化数据库并写入种子数据

# 管理后台（../admin/）
npm run build     # vite 生产构建
```

## 已确认的边界（如实告知）

- Google Photos API 2025-03-31 起：只能访问/写入**本应用创建的相册**，读取用户整库的 scope 已下线（本项目本就不需要）。
- "原图"指页面会话内可获取的最大尺寸版本；无法绕过登录墙/付费墙/严格防盗链（无 CORS 且校验 Referer 的资源浏览器层面不可读，会给出明确失败原因）。
- 大批量上传受 Service Worker 生命周期影响，已做持久化 + 心跳恢复；极端情况下浏览器强杀可能中断，重开浏览器后自动续跑。
- 上传计入 Google 存储空间。
- 额度/套餐基于「产品账号」（扩展自建账号体系），与 Google 账号授权相互独立；未配置后端或未登录产品账号时，上传配额校验会自动跳过并放行（本地不限次）。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 点上传提示「未配置 OAuth Client ID」 | 设置页粘贴 Client ID |
| 上传后任务暂停提示授权失效 | 点 👤 重新登录，任务自动继续 |
| 某图一直「下载失败/跨域(CORS)」 | 点上传时会**自动弹出**「授予所有网站下载权限」；或设置页手动点「授予所有网站下载权限」，再重试 |
| 上传/下载很慢 | 先授予「所有网站」下载权限，后台即可直接抓图（绕过跨域、不走 base64 分块），明显提速 |
| 列表缺图 | 点「⟳ 扫描图片」重扫；动态加载页多等几秒增量自动补 |
| 想换默认相册命名 | 设置页改模板，支持 `{domain}` `{date}` |
| 上传提示「额度用尽」 | 弹窗点「升级」→ 登录产品账号 → 选择套餐购买；或设置页关闭「配额校验」放行 |
| 管理后台怎么进 | 部署后访问 Nginx 站点，用 `ADMIN_EMAIL` 管理员邮箱登录（生产用密码登录） |
