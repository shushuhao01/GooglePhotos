#!/bin/zsh
# 端到端集成验证引导：启动 MySQL + backend，并在就绪后运行 API 冒烟测试
set -e
MYSQL=/opt/homebrew/opt/mysql/bin/mysqld
NODE=/Users/huangfeng/.workbuddy/binaries/node/versions/22.12.0/bin/node
DATA=/tmp/wiu-mysql-data
# 定位 backend 根目录（兼容任意放置位置）
SQL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SQL_DIR"

# 1) 启动 MySQL（若未运行）
if ! pgrep -f wiu-mysql-data >/dev/null; then
  echo "[boot] starting mysql..."
  "$MYSQL" --datadir="$DATA" --port=3306 --socket=/tmp/wiu-mysql.sock > /tmp/wiu-mysql.log 2>&1 &
fi
# 等待 MySQL 就绪
until nc -z -w2 127.0.0.1 3306; do sleep 1; done
echo "[boot] mysql ready"

echo "[boot] init schema..."
"$NODE" dist/scripts/init-schema.js 2>&1 | tail -3 || true

echo "[boot] starting backend..."
"$NODE" dist/app.js > /tmp/wiu-backend.log 2>&1 &
# 等待 backend 就绪
sleep 4
curl -s http://localhost:8787/health > /tmp/wiu-health.json 2>/dev/null || true
echo "[boot] backend health: $(cat /tmp/wiu-health.json)"

echo "[boot] running smoke tests..."
"$NODE" <<'EOF'
const API='http://localhost:8787/api/v1';
async function j(path,opt){const r=await fetch(API+path,opt);return {s:r.status,d:await r.json()};}
(async()=>{
  // 1 健康
  console.log('1 health', (await fetch('http://localhost:8787/health')).status);
  // 2 登录(admin)
  let x=await j('/auth/dev-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com'})});
  const token=x.d.token;
  console.log('2 dev-login ok=',x.d.ok,'admin=',x.d.user.admin);
  // 3 套餐
  x=await j('/plans'); console.log('3 plans', x.d.plans.length);
  // 4 权益状态
  x=await j('/entitlements/status',{headers:{Authorization:'Bearer '+token}}); console.log('4 entitlement', JSON.stringify(x.d.entitlement));
  // 5 预扣
  x=await j('/entitlements/reserve',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({operation:'upload'})}); console.log('5 reserve', x.d.ok, x.d.reservation?x.d.reservation.slice(0,6):'-');
  // 6 权益状态(扣后)
  x=await j('/entitlements/status',{headers:{Authorization:'Bearer '+token}}); console.log('6 after reserve upload_remaining', x.d.entitlement.upload_remaining);
  // 7 创建订单(mock)
  x=await j('/billing/checkout',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({planCode:'pro-month',provider:'mock'})});
  const orderNo=x.d.orderNo; console.log('7 checkout orderNo', orderNo, 'amount', x.d.amountCents);
  // 8 支付完成(mock)
  x=await j('/billing/mock-pay/'+orderNo,{method:'POST',headers:{Authorization:'Bearer '+token}}); console.log('8 mock-pay', x.d.ok, x.d.status);
  // 9 订单列表
  x=await j('/billing/orders',{headers:{Authorization:'Bearer '+token}}); console.log('9 orders', x.d.orders.length, 'status', x.d.orders[0].status);
  // 10 权益(订阅后额度应增加)
  x=await j('/entitlements/status',{headers:{Authorization:'Bearer '+token}}); console.log('10 after subscribe upload_remaining', x.d.entitlement.upload_remaining);
  // 11 admin 仪表盘
  x=await j('/admin/dashboard',{headers:{Authorization:'Bearer '+token}}); console.log('11 dashboard stats', JSON.stringify(x.d.stats));
  // 12 admin 支付渠道
  x=await j('/admin/payment-channels',{headers:{Authorization:'Bearer '+token}}); console.log('12 channels', x.d.channels.length);
  // 13 保存支付宝渠道(测试配置)
  x=await j('/admin/payment-channels/alipay',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({enabled:true,config:{appId:'test',notifyUrl:API}})}); console.log('13 save alipay ch', x.d.ok);
  // 14 支付宝连接测试
  x=await j('/admin/payment-channels/alipay/test',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({appId:'test'})}); console.log('14 alipay test reachable', x.d.reachable, 'missing', JSON.stringify(x.d.missing));
  // 15 风控
  x=await j('/admin/risk-rules',{headers:{Authorization:'Bearer '+token}}); console.log('15 risk rules', x.d.rules.length);
  // 16 审计
  x=await j('/admin/audit-logs',{headers:{Authorization:'Bearer '+token}}); console.log('16 audit logs', x.d.logs.length);
  // 17 系统配置
  x=await j('/admin/system-configs',{headers:{Authorization:'Bearer '+token}}); console.log('17 configs', x.d.configs.length);
  // 18 ZIP 任务
  x=await j('/zip/jobs',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({files:['https://example.com/a.jpg']})}); console.log('18 zip job', x.d.jobNo);
  // 19 无鉴权应 401
  x=await j('/entitlements/status'); console.log('19 no-auth', x.s);
  console.log('SMOKE DONE');
})().catch(e=>{console.error('SMOKE FAIL',e);process.exit(1);});
EOF
echo "[boot] smoke finished"
