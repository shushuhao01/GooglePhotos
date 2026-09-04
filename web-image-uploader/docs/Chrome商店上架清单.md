# Chrome Web Store 上架清单（纯免费版）

本文对应当前发行版：不收费、不登录产品账号、不连接收费后台、不设置上传/下载次数配额。Google 登录只在用户主动选择“上传到 Google Photos”时触发。

## 发布前必须替换/确认

1. 在 Chrome Web Store Developer Dashboard 注册开发者账号并完成一次性注册费、开发者身份和联系邮箱验证。
2. 用“加载已解压的扩展程序”生成最终扩展 ID；在 Google Cloud 的 OAuth 客户端中将该 ID 绑定为 Chrome Extension client。商店重新上传后不得更换 ID。
3. OAuth Consent Screen 切换 Production，填写应用名称、开发者邮箱、隐私政策 URL；Photos Library API 的敏感/受限 scope 按 Google 要求提交验证。测试阶段账号需加入 Test users。
4. 将 `docs/隐私政策.md` 发布为公网 HTTPS 页面，并把 `support@example.com` 替换为真实客服邮箱；同时发布服务条款和数据删除说明。
5. 准备 128/48/32/16 图标、至少 1 张 1280×800 或 640×400 的功能截图、清晰的中英文名称/描述。截图不得含测试账号、调试信息或虚假效果。
6. 递增 `manifest.json` 的 `version`，运行根目录测试和语法检查，并以 ZIP 上传（不要把 `node_modules`、后端源码或密钥打包进扩展）。

## 权限用途说明（提交表单可直接参考）

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存用户设置、扫描结果、任务进度和 OAuth 加密无关的令牌状态（仅本地 Chrome 存储）。 |
| `identity` | 发起 Google OAuth，并在 Google Photos 上传前获取用户授权。 |
| `scripting` / `activeTab` | 用户点击扫描后读取当前页面图片；不在后台持续读取页面。 |
| `alarms` | Service Worker 唤醒后恢复未完成任务。 |
| `contextMenus` | 提供用户主动触发的右键扫描/上传操作。 |
| `clipboardWrite` | 用户点击“复制地址”时写入剪贴板。 |
| `downloads` | 用户点击下载或 ZIP 后调用 Chrome 下载器保存文件。 |
| `windows` | 全屏图片预览时读取当前窗口状态并恢复。 |
| `unlimitedStorage` | 保存大量扫描缩略图和任务历史；不会上传到开发者服务器。若审核要求最小权限，可在发布前移除并将历史上限改为普通存储。 |
| 可选 `<all_urls>` | 仅在用户主动授予后，后台直接读取图片以提高跨域/防盗链兼容性；拒绝时仍使用当前页面上下文。 |

## 商店描述（中文）

**Google相册上传与批量下载**：扫描当前网页中的图片，默认筛选内容图，支持列表/卡片视图、缩略图、尺寸筛选、勾选、预览和全屏浏览。可将选中图片批量上传到用户自己的 Google Photos，也可批量下载图片到本地文件夹。所有下载操作由用户主动触发；扩展不收费、不设次数配额，不需要产品账号。ZIP 打包功能暂时停用。

## Store description (English)

**Google Photos Uploader & Batch Downloader** scans images on the current page, prioritizes content images, and provides list/card views, thumbnails, size filters, selection, preview and full-screen browsing. Users can batch-upload selected images to their own Google Photos account or batch-download images to a local folder. Downloads and uploads are user-initiated. The extension is free, has no usage quota, and does not require a product account. ZIP packaging is temporarily disabled.

## 提交流程

创建新项目 → 上传 ZIP → 填名称、简短描述、详细描述、图标和截图 → 填隐私权惯例（不出售数据、不用于广告；Google OAuth/Photos 为功能所需）→ 逐项填写权限用途 → 选择分发地区和公开/非公开 → 提交审核。审核被问到数据流向时，说明图片默认直接在浏览器与目标站点/Google Photos 之间传输；当前免费版没有自有收费服务器。

## 常见退回原因

- OAuth client 未绑定最终扩展 ID，或使用了未验证的敏感 scope；
- 隐私政策不是公网 HTTPS、邮箱仍是示例地址；
- 描述声称“支持所有网站/保证下载原图”，但权限或站点策略无法保证；
- 请求权限没有逐项说明，或 `<all_urls>` 未解释为可选权限；
- 截图含开发者工具、测试域名、账号信息或与实际功能不一致。
