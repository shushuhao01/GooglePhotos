#!/bin/bash

# ========================================
# Web Image Uploader 一键更新脚本 v1.0
# 适用：git pull 拉取最新代码 → 安装依赖 → 构建各端 → PM2 重启 → 健康检查
# 兼容：本机开发环境 / 宝塔服务器（自动检测项目根目录）
# ========================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# 自动定位项目根目录（脚本所在目录 = 仓库根目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"

echo -e "${CYAN}==========================================${NC}"
echo -e "${CYAN}  Web Image Uploader 一键更新脚本 v1.0${NC}"
echo -e "${CYAN}==========================================${NC}"
echo ""
echo -e "${YELLOW}[i] 项目根目录: $PROJECT_DIR${NC}"

# 检查项目目录关键子项目存在
for sub in backend admin web-image-uploader; do
  if [ ! -d "$PROJECT_DIR/$sub" ]; then
    echo -e "${RED}[X] 错误：缺少子项目目录: $PROJECT_DIR/$sub${NC}"
    exit 1
  fi
done
echo -e "${GREEN}[OK] 子项目齐全: backend / admin / web-image-uploader${NC}"
echo ""

# 设置 Node.js 内存限制
TOTAL_MEM=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 4096)
if [ "$TOTAL_MEM" -lt 3000 ]; then
    NODE_MEM=1536
else
    NODE_MEM=4096
fi
export NODE_OPTIONS="--max-old-space-size=$NODE_MEM"

# ==================== Step 1: 备份配置文件 ====================
echo -e "${YELLOW}[1] 备份配置文件...${NC}"
[ -f "$PROJECT_DIR/backend/.env" ] && cp "$PROJECT_DIR/backend/.env" "$PROJECT_DIR/backend/.env.backup" && echo -e "  ${GREEN}[OK] backend/.env 已备份${NC}"
[ -f "$PROJECT_DIR/.env.production" ] && cp "$PROJECT_DIR/.env.production" "$PROJECT_DIR/.env.production.backup" && echo -e "  ${GREEN}[OK] .env.production 已备份${NC}"
echo ""

# ==================== Step 2: 拉取代码 ====================
echo -e "${YELLOW}[2] 拉取最新代码...${NC}"
cd "$PROJECT_DIR"
# 修复 git 目录所有权检测（宝塔/www 部署时目录属主与执行用户不一致，git 默认拒绝访问）
if git config --global --add safe.directory "$PROJECT_DIR" 2>/dev/null; then
  echo -e "  ${GREEN}[OK] 已添加 git safe.directory: $PROJECT_DIR${NC}"
else
  echo -e "  ${YELLOW}[i] 添加 git safe.directory 失败（忽略，继续尝试）${NC}"
fi
# 记录当前分支（无法识别时兜底到 main）
CUR_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo -e "  ${CYAN}当前分支: $CUR_BRANCH${NC}"
git stash save "Auto stash before update $(date '+%Y-%m-%d %H:%M:%S')" 2>/dev/null || true
if git pull origin "$CUR_BRANCH"; then
    echo -e "${GREEN}[OK] 代码拉取成功${NC}"
else
    echo -e "${RED}[X] 代码拉取失败！尝试恢复本地改动...${NC}"
    git stash pop 2>/dev/null || true
    exit 1
fi
echo ""

# ==================== Step 3: 恢复配置文件 ====================
echo -e "${YELLOW}[3] 恢复配置文件...${NC}"
[ -f "$PROJECT_DIR/backend/.env.backup" ] && cp "$PROJECT_DIR/backend/.env.backup" "$PROJECT_DIR/backend/.env" && echo -e "  ${GREEN}[OK] backend/.env 已恢复${NC}"
[ -f "$PROJECT_DIR/.env.production.backup" ] && cp "$PROJECT_DIR/.env.production.backup" "$PROJECT_DIR/.env.production" && echo -e "  ${GREEN}[OK] .env.production 已恢复${NC}"
echo ""

# ==================== Step 4: 安装/更新依赖 ====================
echo -e "${YELLOW}[4] 更新依赖...${NC}"

echo -e "  ${YELLOW}[4.1] backend 依赖...${NC}"
cd "$PROJECT_DIR/backend"
npm install 2>&1 | tail -2
# 修复宝塔/www 部署后 node_modules/.bin 工具缺失执行权限的问题（导致 tsc/vite Permission denied）
chmod -R 755 "$PROJECT_DIR/backend/node_modules/.bin" 2>/dev/null || true
echo -e "  ${GREEN}[OK] backend 依赖已更新${NC}"

echo -e "  ${YELLOW}[4.2] admin 管理后台依赖...${NC}"
cd "$PROJECT_DIR/admin"
npm install 2>&1 | tail -2
chmod -R 755 "$PROJECT_DIR/admin/node_modules/.bin" 2>/dev/null || true
echo -e "  ${GREEN}[OK] admin 依赖已更新${NC}"

echo -e "  ${YELLOW}[4.3] web-image-uploader 扩展无构建依赖（跳过）${NC}"
echo ""

# ==================== Step 5: 构建所有端 ====================
echo -e "${YELLOW}[5] 构建项目...${NC}"

echo -e "  ${YELLOW}[5.1] 构建 backend (tsc)...${NC}"
cd "$PROJECT_DIR/backend"
npm run build 2>&1 | tail -3
echo -e "  ${GREEN}[OK] backend 构建完成${NC}"

echo -e "  ${YELLOW}[5.2] 构建 admin 管理后台 (vite build)...${NC}"
cd "$PROJECT_DIR/admin"
npm run build 2>&1 | tail -3
echo -e "  ${GREEN}[OK] admin 构建完成${NC}"

echo -e "  ${YELLOW}[5.3] web-image-uploader 扩展（源码无构建，仅语法校验）...${NC}"
cd "$PROJECT_DIR/web-image-uploader"
if [ -f "scripts/check-syntax.js" ]; then
  # 自动检测 node（宝塔/unix 通用），退化到常见路径
  if command -v node &> /dev/null; then
    node scripts/check-syntax.js 2>&1 | tail -3 || true
  elif [ -x "/www/server/nodejs/v22.12.0/bin/node" ]; then
    /www/server/nodejs/v22.12.0/bin/node scripts/check-syntax.js 2>&1 | tail -3 || true
  else
    echo -e "  ${YELLOW}[i] 未找到 node，跳过扩展语法校验${NC}"
  fi
  echo -e "  ${GREEN}[OK] 扩展语法校验完成${NC}"
else
  echo -e "  ${YELLOW}[i] 未找到 check-syntax.js，跳过扩展校验${NC}"
fi
echo ""

# ==================== Step 6: 重启后端服务 (PM2) ====================
echo -e "${YELLOW}[6] 重启后端服务 (PM2)...${NC}"
cd "$PROJECT_DIR/backend"

if command -v pm2 &> /dev/null; then
    if pm2 describe web-image-billing &> /dev/null; then
        pm2 restart web-image-billing 2>&1 | tail -3
        echo -e "  ${GREEN}[OK] 已重启 web-image-billing${NC}"
    else
        pm2 start ecosystem.config.cjs 2>&1 | tail -3
        echo -e "  ${GREEN}[OK] 已通过 ecosystem.config.cjs 启动${NC}"
    fi
    pm2 save 2>&1 | tail -1
    echo -e "  ${GREEN}[OK] PM2 进程列表已保存${NC}"
else
    echo -e "${RED}[X] PM2 未安装，跳过自动重启。请手动构建后执行: node dist/app.js${NC}"
fi
echo ""

# ==================== Step 7: 验证部署 ====================
echo -e "${YELLOW}[7] 验证部署...${NC}"
sleep 2

# 读取端口（默认 8787）
PORT=$(grep -E "^PORT=" "$PROJECT_DIR/backend/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "8787")
[ -z "$PORT" ] && PORT=8787

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}[OK] API 健康检查通过 (HTTP $HTTP_CODE)${NC}"
else
    echo -e "  ${YELLOW}[!] API 返回: $HTTP_CODE（可能仍在启动中，请稍后重试或查看日志）${NC}"
fi

# 清理备份
rm -f "$PROJECT_DIR/backend/.env.backup"
rm -f "$PROJECT_DIR/.env.production.backup"

cd "$PROJECT_DIR"

echo ""
echo -e "${CYAN}==========================================${NC}"
echo -e "${GREEN}  更新完成！${NC}"
echo -e "${CYAN}==========================================${NC}"
echo ""
echo -e "${YELLOW}最近提交:${NC}"
git log --oneline -5 2>/dev/null || echo "  (无法读取 git 日志，请确认仓库所有权正确)"
echo ""
echo -e "${YELLOW}服务状态:${NC}"
pm2 list 2>/dev/null || true
echo ""
echo -e "${YELLOW}提示:${NC}"
echo "  - 查看日志:    pm2 logs web-image-billing"
echo "  - 重启服务:    pm2 restart web-image-billing"
echo "  - 如未装PM2:   cd backend && node dist/app.js"
echo ""
