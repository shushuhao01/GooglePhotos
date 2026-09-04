// PM2 进程配置：收费后端 web-image-uploader-billing-api
// 用法：pm2 start ecosystem.config.js   （在 backend 目录下执行）
module.exports = {
  apps: [{
    name: 'web-image-billing',
    script: './dist/app.js',
    instances: 1,
    exec_mode: 'fork',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 8787
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    // 日志大小限制：超过 50MB 自动轮转
    max_size: '50M',
    // 最多保留 3 个旧日志文件
    retain: 3,
    // 旧日志压缩
    compress: true,
    // 开发登录在生产环境会自动关闭（由 NODE_ENV=production 控制）
    // 启动失败时的重启退避
    min_uptime: '5s',
    max_restarts: 10
  }]
};
