# Chrome 网页高清图片批量上传 Google 相册

## 0. 可行性分析（先说结论）

**结论：需求可以实现。** 单张/批量选择网页高清图、首次绑定 Google 账号、批量一键上传、Popup 小窗口展示详细上传信息，这条完整链路在当前技术条件下全部成立。市面现有插件只支持单张上传，主要短板在批量队列、任务持久化和进度管理，均为工程实现问题，不存在不可逾越的技术障碍。

### 0.1 Google Photos API 现状（2025-03-31 政策变化，必须知晓）

Google 于 2025 年 3 月 31 日对 Photos API 做了重大收紧，影响如下：

| 能力 | 当前状态 | 对本项目的影响 |
| --- | --- | --- |
| 读取用户**整个**相册 | ❌ 已移除（`photoslibrary.readonly`、`photoslibrary.sharing`、`photoslibrary` 三个 scope 停用） | 无影响，本项目不需要读已有照片 |
| **上传图片 / 创建媒体项** | ✅ 保留（`photoslibrary.appendonly`） | 核心功能可用 |
| 创建相册、向相册添加照片 | ✅ 保留，但**仅限本插件自己创建的相册** | "选择已有相册"只能列出本插件创建的相册 |
| 读取本插件上传的内容 | ✅ 保留（`photoslibrary.readonly.appcreateddata`） | 可用于历史记录回填、查重核对 |
| 从相册挑选照片（Picker API） | ✅ 保留 | 与本项目方向相反，不需要 |

**重要推论：**
- "指定已有相册上传"功能必须降级为"从本插件创建过的相册中选择"，用户手工在 Google Photos 中创建的相册插件看不到、也无法写入。
- 上传的照片会计入用户 Google 存储空间（Google 自 2021 年 6 月起已取消免费无限量）。
- 未发布的 OAuth 应用处于 Testing 状态时，仅允许测试用户授权，且 refresh token 有效期受限；自用场景下将本人账号加入测试用户即可。

### 0.2 各需求点可行性拆解

| 需求点 | 可行性 | 说明 |
| --- | --- | --- |
| 扫描当前网页所有图片 | ✅ | Content Script 解析 DOM（img/srcset/picture/CSS 背景/懒加载属性） |
| 指定选择页面中的图片 | ✅ | Popup 内缩略图列表勾选，支持单选/全选/反选/筛选 |
| 缩略图推断原图 | ✅（尽力而为） | srcset 取最大宽度项 + URL 规则重写（去尺寸参数）+ HEAD 探测验证，详见第 11 章 |
| 首次绑定账号 | ✅ | `chrome.identity.launchWebAuthFlow` 走标准 OAuth 2.0 |
| 后续免登录上传 | ✅ | refresh token 存于 `chrome.storage.local`，自动续期 |
| 批量一键上传 | ✅ | Service Worker 任务队列 + 并发控制，依赖 `appendonly` scope |
| Popup 小窗口详细进度 | ✅ | Popup 与 Service Worker 消息同步；Popup 关闭后任务继续 |
| 绕过防盗链下载图片 | ✅（大部分场景） | 优先由 Content Script 在页面上下文内 fetch（自带 Referer/Cookie），后台 fetch 兜底 |

### 0.3 明确做不到的事（边界声明）

- 不能访问或写入用户在 Google Photos 网页里手工创建的相册。
- 不能读取用户相册里已有的照片来做上传前去重（去重只能靠本地历史记录）。
- 不能绕过登录墙、付费墙获取网站服务端未对当前会话开放的"真正原图"。
- 不能承诺 Service Worker 永不中断：浏览器强制回收时会做断点恢复，极端情况下长任务可能被截断，重开浏览器后续传。

## 1. 文档信息

- 产品名称：网页高清图片上传 Google 相册插件
- 产品形态：Chrome Manifest V3 浏览器扩展
- 使用对象：个人自用，后续可扩展为公开发布版本
- 初始语言：简体中文
- 目标平台：Google Chrome 及 Chromium 内核浏览器
- 版本目标：V1.0 可用版

## 2. 产品目标

用户访问任意网页时，插件能够识别页面中的图片资源，尽可能找到尺寸最大、质量最高的图片版本，并提供单选或批量选择功能。用户首次使用时绑定 Google 账号，之后可以将选中的图片批量上传到 Google Photos，并在插件小窗口中查看详细进度、结果和失败原因。

“高清原图”应定义为“页面当前可访问的候选资源中质量最高的版本”，不能承诺绕过登录、付费、权限控制、反爬或防盗链获取网站服务器上不存在于页面中的原始文件。

## 3. 用户角色与典型场景

### 3.1 用户角色

V1 仅支持单用户本地使用。每个浏览器配置文件可绑定一个 Google Photos 账号；支持退出、重新授权和切换账号。

### 3.2 典型场景

1. 用户打开图片列表页，点击插件图标。
2. 插件扫描页面，列出图片缩略图、原始地址、像素尺寸和文件大小。
3. 用户选择一张或多张图片，点击“上传到 Google 相册”。
4. 未授权时弹出 Google 登录及授权页面。
5. 授权完成后开始下载和上传，Popup 显示实时进度。
6. 用户关闭 Popup 后，任务仍在后台继续；重新打开可查看任务状态。
7. 失败项目支持单个重试或批量重试。

## 4. 功能范围

### 4.1 页面图片扫描

必须支持：

- `img[src]`
- `img[srcset]` 和 `sizes`
- `picture/source[srcset]`
- 页面内懒加载属性，如 `data-src`、`data-original`、`data-lazy-src`
- CSS `background-image: url(...)`
- 可选扫描 `<a>` 链接指向的图片文件
- 扫描滚动后新增的图片，使用 `MutationObserver` 监听动态 DOM
- 手动“重新扫描”按钮
- 仅扫描当前标签页，不跨标签页收集图片

建议支持：

- 常见图片后缀：jpg、jpeg、png、webp、gif、avif、heic（能被浏览器解码时）
- 从缩略图 URL 推断原图 URL，例如替换尺寸参数、去除缩略参数
- 对常见 CDN 参数提供可配置的原图规则
- 对需要登录的网页使用当前页面会话下载，不能绕过权限

扫描结果字段：

- 唯一标识
- 页面来源 URL
- 候选图片 URL 列表
- 当前选中的最佳 URL
- 图片宽度、高度、像素总量
- 文件类型和文件大小（可获取时）
- 图片来源元素类型
- 是否疑似缩略图
- 是否重复
- 识别警告

### 4.2 高清图选择

列表卡片必须显示：

- 图片缩略图
- 选择框
- 分辨率，如 `3840 × 2160`
- 文件类型
- 文件大小；未知时显示“未知”
- “查看原图”按钮
- “复制图片地址”按钮
- 高清识别状态

必须提供：

- 全选
- 取消全选
- 反选
- 仅选择高清图
- 按分辨率排序
- 按文件大小排序
- 按页面位置排序
- 搜索或按域名筛选
- 排除重复图片
- 手动切换候选资源
- 单张上传
- 批量上传

分辨率策略：

- 优先选择实际像素宽高较大的资源
- 同分辨率时优先文件体积较大、格式质量更高的资源
- 默认不把放大后的缩略图认定为原图
- 无法读取尺寸时保留资源，但标记为“无法确认高清”
- 采用可配置的最低尺寸阈值，默认长边不低于 1600px

### 4.3 Google 账号绑定

必须支持：

- 首次点击上传时触发 OAuth 授权
- 显示当前授权账号邮箱或脱敏标识
- 账号授权成功后保存可续期的授权状态
- 账号退出
- 重新授权
- 切换账号
- 授权失败提示和重试
- Token 失效时自动刷新或引导重新授权

授权原则：

- 使用 Google OAuth，不收集或保存用户密码
- 只申请 Google Photos 上传所需最小权限
- 不在插件中保存 OAuth client secret
- OAuth 回调必须限制到插件自身的扩展 ID
- 将授权状态存储在 `chrome.storage.local`，不存储在网页 DOM 或 URL 参数中

OAuth 授权范围（scope）设计：

- 必须申请：`https://www.googleapis.com/auth/photoslibrary.appendonly`
  - 用途：上传字节、创建 media item、创建相册、向本插件创建的相册添加照片
- 可选申请：`https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata`
  - 用途：列出本插件创建的相册、读取本插件上传的 media item（相册选择、历史核对）
- 可选申请：`https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata`
  - 用途：后续整理本插件相册内照片（V1 可不申请）
- 明确不申请：`photoslibrary.readonly`、`photoslibrary.sharing`、`photoslibrary`（已于 2025-03-31 移除）

授权流程选型：

- 首选 `chrome.identity.launchWebAuthFlow`：标准 OAuth 2.0 授权码 + PKCE 流程，Chrome Extension 类型 client，回调地址为 `https://<extension-id>.chromiumapp.org/`
- 不用 `chrome.identity.getAuthToken` 作为唯一方案：它依赖 Chrome 浏览器登录态，在部分 Chromium 浏览器不可用；可作为增强项兜底
- Token 管理：access token 内存缓存，refresh token 持久化到 `chrome.storage.local`；Testing 状态的 OAuth 应用 refresh token 约 7 天过期，自用场景到期时静默重引导授权即可；若发布需完成 Google OAuth 验证

Google Cloud 配置要求：

- 创建 Google Cloud Project
- 配置 OAuth consent screen（External 类型，自用可保持 Testing 状态，将本人 Gmail 加入测试用户）
- 创建 Chrome 扩展程序类型 OAuth Client（填写扩展 ID；本地开发先用 `chrome://extensions` 开发者模式加载后的固定 key 保持 ID 不变）
- 启用 Google Photos Library API
- 配置测试用户
- 记录 API 配额、上传限制及当前政策要求（详见 4.4.1）
- 生产发布前确认 Google API 对 Photos 上传、相册创建和批量接口的最新限制

### 4.4 Google Photos 上传

上传流程（每张图片）：

1. 从网页下载图片二进制内容（优先页面上下文 fetch，后台 fetch 兜底，详见 4.8）。
2. 校验 HTTP 状态、Content-Type、文件大小和可解码性。
3. 调用 `POST https://photoslibrary.googleapis.com/v1/uploads` 上传原始字节，请求头携带 `X-Goog-Upload-Content-Type`（图片 MIME）、`X-Goog-Upload-Protocol: raw`、文件名放在 `X-Goog-Upload-File-Name`；响应体为 upload token（纯文本）。
4. 调用 `POST https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate`，将 upload token 映射为 media item；单次 batchCreate 最多 50 个 newMediaItem。
5. 需要写入相册时，在 batchCreate 请求体中携带 `albumId`（仅本插件创建的相册有效）。
6. 保存每张图片的上传结果（mediaItemId、productUrl、上传时间）。

上传选项：

- 上传到默认相册（即不加相册，进入相册库首页）
- 从**本插件创建过的相册**中选择（通过 `albums.list` + `readonly.appcreateddata` 获取；Google 政策限制，看不到用户手工创建的相册）
- 创建新相册（`albums.create`，建议默认命名为 `网页图片 - 域名 - 日期`）
- 新相册名称自定义
- 是否跳过疑似重复图片（依据本地历史的内容哈希，非云端查重）
- 最大并发数，默认 2
- 失败自动重试次数，默认 2
- 是否保留任务记录

#### 4.4.1 API 配额与限制（开发时以官方文档实时值为准）

- Photos Library API 默认项目配额约 10,000 次请求/天，超限返回 429；批量上传场景按"1 次 uploads + 1/50 次 batchCreate"每张摊销，默认配额可支撑数千张/天，基本满足自用。
- uploads 接口单文件上限：图片约 200MB；本项目默认单文件上限 50MB，可在设置中调整。
- Google Photos 支持上传的图片格式：JPEG、PNG、WebP、HEIC、GIF（含动图）及部分 RAW；不支持的格式在上传前拦截并提示。
- 上传的照片计入用户 Google 账号存储空间，Popup 与确认框中需明确提示。
- 429/5xx 使用指数退避；配额耗尽时暂停队列并在 Popup 明确提示"今日配额已用完，可明天继续"。

任务状态：

- 待处理
- 下载中
- 下载成功
- 下载失败
- 上传中
- 上传成功
- 上传失败
- 已跳过
- 已取消

必须记录：

- 页面 URL
- 图片 URL
- 图片哈希或内容指纹（本地去重用）
- 文件名
- 文件大小
- MIME 类型
- Google Photos media item ID（成功时）
- 目标相册 ID（有时）
- 开始时间和结束时间
- 错误码和用户可读错误信息

### 4.5 Popup 小窗口

Popup 建议宽度 380–450px，高度不超过 600px。

页面结构：

- 顶部：插件名称、当前账号、设置入口
- 标签页：`图片选择`、`上传任务`、`历史记录`
- 图片选择区：扫描按钮、筛选排序、选择统计
- 操作区：单张上传、批量上传、取消任务
- 上传任务区：总体进度和每张图片进度
- 底部：成功数、失败数、跳过数、重试按钮

上传信息必须详细显示：

- 总数量和已完成数量
- 当前正在处理的文件名
- 下载阶段和上传阶段
- 当前百分比
- 成功、失败、跳过统计
- 预计剩余数量；无法计算时不显示虚假时间
- 失败原因
- 单项重试和全部重试
- 取消未开始任务

### 4.6 后台任务

- Popup 关闭后上传继续执行
- Service Worker 管理任务队列
- 任务状态实时同步到 Popup
- 浏览器重启后恢复可恢复任务
- 浏览器关闭前尽量持久化状态
- 防止同一图片重复加入同一任务
- 支持任务暂停和继续；若 API 或浏览器限制无法可靠暂停，应降级为取消未开始任务
- 任务失败不能阻塞其他图片
- 控制并发，避免内存占用过高

### 4.7 设置页

设置项包括：

- 默认最低图片长边
- 是否包含 GIF/动画图片
- 是否扫描 CSS 背景图
- 是否扫描外链原图
- 默认相册策略
- 默认相册名称
- 并发上传数，范围 1–4
- 自动重试次数，范围 0–3
- 是否上传前确认
- 是否保存历史记录
- 历史记录保留天数
- 清理本地任务数据
- 退出 Google 账号

### 4.8 图片下载策略（跨域与防盗链）

下载成功率直接决定体验，按以下优先级执行：

1. **页面上下文下载（首选）**：Content Script 在原页面内 `fetch(imageUrl)` → 转 `Blob` → 通过消息通道分块传给 Service Worker。天然携带该页面的 Referer、Cookie、登录态，可突破绝大多数防盗链和需要登录的图片。注意单条消息体积限制，大于约 8MB 的文件需分块传输或用 `chrome.runtime.connect` Port 流式传递。
2. **后台直接下载（兜底）**：Service Worker 中 fetch。适用于公开 CDN 图片；需要扩展在 manifest 中声明对应 host permissions。
3. **canvas 提取（最后手段）**：图片已加载进页面但 URL 不可再请求时，`canvas.toBlob()` 导出。注意跨域图片会污染 canvas（`crossOrigin` 不可用时降级为提示用户）。

校验规则：

- HTTP 状态必须为 2xx；301/302 跟随，404/410 标记为"地址已失效"。
- Content-Type 必须为 `image/*` 且格式在 Google Photos 支持列表内。
- 响应体积异常小（如防盗链返回的占位图，< 10KB 且像素小于阈值）时标记警告而非直接上传。
- 下载成功的 Blob 立即进入上传流程，不写入本地磁盘。

## 5. 非功能需求

### 5.1 性能

- 普通页面首次扫描应在 3 秒内完成基础列表展示
- 100 张图片页面不得导致 Popup 卡死
- 批量任务使用队列和并发控制
- 缩略图使用懒加载
- 不长期保存网页原图到本地磁盘
- 单个任务默认限制 500 张，超过后提示用户分批处理

### 5.2 可靠性

- 网络超时默认 30 秒，可配置范围 10–120 秒
- 对 408、429、5xx 等临时错误使用指数退避
- 对 401 自动刷新 Token；刷新失败则暂停并提示重新授权
- 对 403、404、内容类型错误等不可恢复错误不重复重试
- 失败项目可单独重试
- 任务状态持久化后不得因 Popup 关闭而丢失

### 5.3 兼容性

- Chrome 120+ 优先
- 适配 Chromium 系浏览器时不得依赖 Chrome 专属之外的非标准能力
- 适配浅色和深色系统主题
- 支持高 DPI 显示器
- 支持中文界面，预留英文国际化结构

### 5.4 隐私与安全

- 仅读取用户主动打开页面中的图片资源
- 不上传网页地址、浏览历史或图片元数据到第三方服务器
- 图片只经过网页来源与 Google Photos；不设置自建中转服务器
- 不采集分析数据，或必须提供明确关闭开关
- 不使用 `eval` 和远程执行脚本
- CSP 禁止不必要的外部脚本
- 所有外部请求使用 HTTPS
- Token 不写入日志、不展示完整内容
- 本地历史记录提供一键清除
- 明确提示用户：上传内容需拥有相应使用权

## 6. 技术架构

建议目录：

```text
extension/
├── manifest.json
├── src/
│   ├── background/
│   │   ├── service-worker.js
│   │   ├── auth-manager.js
│   │   ├── upload-manager.js
│   │   └── task-store.js
│   ├── content/
│   │   ├── scanner.js
│   │   ├── candidate-selector.js
│   │   └── page-bridge.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── options/
│   ├── shared/
│   │   ├── messages.js
│   │   ├── validators.js
│   │   └── constants.js
│   └── icons/
├── tests/
├── README.md
└── package.json
```

模块职责：

- Content Script：读取 DOM、监听动态图片、提取候选 URL，不执行上传。
- Popup：展示和交互，不直接承担长时间网络任务。
- Service Worker：OAuth、下载、上传、队列、重试和状态持久化。
- Task Store：保存任务、图片状态、设置和必要的结果。
- Google Photos Client：封装上传 token、media item、相册操作。

## 7. 消息协议

Content Script 与 Service Worker 之间使用 `chrome.runtime.sendMessage` 或 Port 通信。

建议消息类型：

- `SCAN_PAGE`
- `SCAN_RESULT`
- `REFRESH_SCAN`
- `START_UPLOAD`
- `CANCEL_TASK`
- `RETRY_ITEM`
- `RETRY_FAILED`
- `GET_TASK_STATUS`
- `TASK_STATUS_UPDATED`
- `AUTH_REQUIRED`
- `START_AUTH`
- `LOGOUT`
- `GET_SETTINGS`
- `SAVE_SETTINGS`

所有消息必须校验来源、操作类型和参数，禁止把网页传入的任意 URL 当作可信数据执行。

## 8. 权限设计

初始权限应尽量精简：

- `storage`：保存设置、任务和授权状态
- `identity`：Google OAuth 流程
- `activeTab`：用户点击插件时访问当前活动页面
- `scripting`：按需执行扫描逻辑

Host permissions 应按实际下载策略设计。若使用页面上下文下载，可减少永久站点权限；若由后台直接下载跨域图片，则需要申请匹配的主机权限。首次使用时应向用户解释权限用途，不能默认申请全站权限而不说明。

## 9. 错误处理

用户可读错误示例：

- 图片地址已失效，请重新扫描
- 网站拒绝跨域访问，请尝试在原页面重新加载
- 图片需要登录后才能访问
- 图片格式无法识别
- 图片超过单文件大小限制
- Google 账号授权已失效，请重新绑定
- Google Photos 暂时限流，稍后自动重试
- 目标相册不存在或无权限访问
- 当前任务数量过多，请分批上传

日志要求：

- 开发模式提供脱敏调试日志
- 生产模式不输出 Token、Cookie 和完整隐私 URL
- Popup 提供“复制错误详情”功能
- 日志仅保存在本地，支持清除

## 10. 数据模型

### ImageCandidate

```ts
{
  id: string,
  pageUrl: string,
  sourceUrl: string,
  selectedUrl: string,
  candidateUrls: string[],
  width?: number,
  height?: number,
  byteSize?: number,
  mimeType?: string,
  isLikelyOriginal: boolean,
  isDuplicate: boolean,
  selected: boolean,
  warning?: string
}
```

### UploadTask

```ts
{
  id: string,
  createdAt: string,
  updatedAt: string,
  accountId?: string,
  albumId?: string,
  albumName?: string,
  status: "queued" | "running" | "paused" | "completed" | "cancelled" | "failed",
  total: number,
  completed: number,
  succeeded: number,
  failed: number,
  skipped: number,
  items: UploadItem[]
}
```

### UploadItem

```ts
{
  id: string,
  candidateId: string,
  fileName: string,
  sourceUrl: string,
  status: string,
  progress: number,
  mediaItemId?: string,
  errorCode?: string,
  errorMessage?: string,
  retryCount: number
}
```

## 11. 原图识别规则

候选资源评分建议：

- 实际像素总量：高分
- 长边尺寸：高分
- `srcset` 中的密度或宽度描述：高分
- URL 中包含 `original`、`full`、`large`、`master`：加分
- URL 中包含 `thumb`、`thumbnail`、`small`、`avatar`：减分
- 文件体积更大：适度加分
- 图片类型为 JPEG/PNG/WebP：按实际质量评估
- 仅依赖 URL 字符串不能直接认定原图

必须把“原图候选”与“已确认原图”区分展示，避免给用户造成绝对保证。

## 12. 测试要求

### 12.1 单元测试

- `srcset` 解析
- 原图候选评分
- URL 去重
- 文件名生成
- MIME 类型判断
- 重试策略和退避时间
- 任务状态转换
- 并发队列
- 设置值范围校验

### 12.2 集成测试

- OAuth 首次授权、取消授权、Token 失效
- Google Photos 上传成功
- 相册创建与选择
- 429/5xx 自动重试
- 401 重新授权
- Popup 关闭后任务继续
- 浏览器重启后任务恢复
- 100 张图片批量任务

### 12.3 页面兼容测试

- 静态 HTML 图片页
- `srcset` 响应式图片页
- 懒加载图片页
- 无限滚动页面
- CSS 背景图页面
- 图片防盗链页面
- 需要登录的页面
- 动态 SPA 页面
- 含 SVG、GIF、WebP、AVIF 的页面

### 12.4 安全测试

- 不向网页注入未授权脚本
- 不泄露 OAuth Token
- 恶意 URL、超长 URL 和异常 MIME 输入校验
- Popup 消息来源校验
- CSP 检查
- 本地数据清理有效

## 13. 验收标准

V1.0 满足以下条件才算完成：

1. 用户可在普通图片网页中看到扫描结果。
2. 用户可单选、全选、反选和筛选图片。
3. 结果包含缩略图、分辨率、类型和可用的文件大小。
4. 首次上传可完成 Google OAuth 授权。
5. 至少 20 张图片可以批量加入上传队列。
6. Popup 能显示总体和单项上传状态。
7. Popup 关闭后任务仍能继续。
8. 失败项目能显示原因并支持重试。
9. 401、429、5xx 等情况有合理处理。
10. 用户可以退出账号和清理本地数据。
11. 插件不保存 Google 密码，不泄露 Token。
12. Chrome 开发者模式加载、刷新和重新授权流程正常。
13. 相册选择仅列出本插件创建的相册，且界面中明确说明该限制（Google API 政策所致）。
14. 防盗链页面图片在页面上下文下载策略下成功率不低于 90%（以常见图站抽样测试为准）。

## 14. 开发阶段

### 阶段一：基础框架

- 初始化 Manifest V3
- 搭建 Popup、Options、Content Script 和 Service Worker
- 建立消息协议和本地数据存储
- 完成基础图片扫描

### 阶段二：图片识别与选择

- 实现候选 URL 提取
- 实现尺寸探测和高清评分
- 实现去重、排序、筛选和预览
- 增加动态页面监听

### 阶段三：Google OAuth 与上传

- 配置 Google Cloud Project
- 实现 OAuth 登录、退出和 Token 管理
- 封装 Photos 上传流程
- 实现相册选择或创建

### 阶段四：后台任务与 Popup

- 实现队列、并发、取消和重试
- 实现持久化任务
- 实现实时进度显示
- 完成历史记录和设置页

### 阶段五：质量与发布

- 完成单元、集成和兼容测试
- 检查权限最小化和隐私说明
- 处理 Google API 配额和政策限制
- 编写安装、配置和故障排查文档

## 15. 后续增强

- 按网页、域名或日期自动创建相册
- 上传前图片压缩或格式转换
- 感知重复图片
- 识别图片中的原图下载按钮
- 自定义 CDN 原图规则
- 批量导入网页链接
- 导出任务报告
- 本地加密保存任务信息
- 多账号管理
- Firefox、Edge 适配

## 16. 关键风险

1. **Google Photos API 政策（已发生一次，可能再变）**：2025-03-31 Google 移除了读取整个相册的三个 scope，本项目依赖的 `appendonly`（上传）scope 目前保留，但未来存在继续收紧的可能。开发时必须以当前官方文档和实际 API 返回为准，代码中将 API 域名、scope 列表集中配置，便于快速适配。
2. **OAuth Testing 状态限制**：自用场景不发布应用时，refresh token 约 7 天过期，表现为"大约每周需要重新点一次授权"。这是 Google 的政策限制，需在 Popup 中以友好方式提示，不能误导为插件故障。
3. 不同网站的图片 URL 规则差异很大，原图识别应采用通用规则加可扩展站点适配器。
4. 跨域、Cookie、防盗链和登录态会影响图片下载成功率（缓解方案见 4.8）。
5. 大批量上传会受到浏览器 Service Worker 生命周期（约 30 秒空闲回收，需靠任务心跳保活）、网络波动和 API 限流影响。
6. 上传内容计入用户 Google 存储空间，账号空间不足时上传会失败，需有明确错误提示。
7. 若未来发布到 Chrome Web Store，需要额外准备隐私政策、权限说明、OAuth 验证（敏感 scope 审核）和商店审核材料，周期可能数周。

## 17. V1 默认决策

- 默认并发数：2
- 默认最低长边：1600px
- 默认批量上限：500 张
- 默认失败重试：2 次
- 默认扫描范围：当前活动页面
- 默认不上传无法确认类型的资源
- 默认跳过完全相同内容的重复图片
- 默认上传前显示确认框
- 默认只保存必要任务元数据，不保存原图文件
