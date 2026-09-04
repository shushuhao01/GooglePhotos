# 官方网站

官网静态站点，部署到 `gp.abc222.cn` 根路径：

- `/` 官网首页
- `/privacy/` 隐私政策
- `/terms/` 服务条款
- `/admin/` 由同一 Nginx 站点反向代理到现有 `admin` 管理后台

本目录不包含收费逻辑，也不接收或存储图片。将 `assets/site.css` 与页面文件部署到站点静态目录即可。生产环境请开启 HTTPS，并在 Google OAuth 品牌设置中填写：

```text
首页：https://gp.abc222.cn/
隐私政策：https://gp.abc222.cn/privacy/
服务条款：https://gp.abc222.cn/terms/
客服邮箱：hfyouqian3@gmail.com
```

## 宝塔/Nginx 路径规划

官网静态文件放在站点根目录；先在 `admin` 目录执行 `npm run build`，再将生成的 `admin/dist` 目录内容复制到官网根目录的 `admin/`（管理后台已配置 `/admin/` 资源基路径）。示例：

```nginx
server {
    listen 443 ssl;
    server_name gp.abc222.cn;
    root /www/wwwroot/gp.abc222.cn/official-site;

    location / { try_files $uri $uri/ /index.html; }
    location /privacy/ { try_files $uri $uri/ /privacy/index.html; }
    location /terms/ { try_files $uri $uri/ /terms/index.html; }
    location /admin/ { try_files $uri $uri/ /admin/index.html; }
}
```

如果后台由宝塔单独创建 Node 服务，也可以将 `/admin/` 改成反向代理；官网仍保持 `https://gp.abc222.cn/`、`/privacy/`、`/terms/` 三个公开路径。
