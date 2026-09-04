<template>
  <div class="dash">
    <el-row :gutter="18">
      <el-col :span="6" v-for="c in cards" :key="c.label">
        <div class="stat-card">
          <el-icon class="stat-icon" :style="{ background: c.bg, color: c.color }"><component :is="c.icon" /></el-icon>
          <div class="stat-body">
            <span class="stat-label">{{ c.label }}</span>
            <strong class="stat-value">{{ c.value }}</strong>
            <em class="stat-note">{{ c.note }}</em>
          </div>
        </div>
      </el-col>
    </el-row>

    <div class="panel">
      <div class="panel-head"><b>系统概览</b><span>实时数据</span></div>
      <div class="overview">
        <div class="ov-item"><span>今日收入</span><strong>¥ {{ (stats.revenueCents/100).toFixed(2) }}</strong></div>
        <div class="ov-item"><span>已支付订单</span><strong>{{ stats.paidOrders }}</strong></div>
        <div class="ov-item"><span>全部订单</span><strong>{{ stats.orders }}</strong></div>
        <div class="ov-item"><span>注册用户</span><strong>{{ stats.users }}</strong></div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><b>套餐一览</b><el-button text type="primary" @click="$router.push('/plans')">管理套餐</el-button></div>
      <el-table :data="plans" style="width:100%">
        <el-table-column prop="code" label="代码" width="140" />
        <el-table-column prop="name" label="名称" />
        <el-table-column prop="billing_period" label="周期" width="110" />
        <el-table-column label="价格" width="130"><template #default="{row}">{{ row.price_cents===0?'免费':'¥'+(row.price_cents/100).toFixed(2) }}</template></el-table-column>
        <el-table-column prop="upload_quota" label="上传/月" width="100" />
        <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.is_active?'success':'info'" size="small">{{ row.is_active?'启用':'停用' }}</el-tag></template></el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, markRaw } from 'vue';
import { req } from '../api';
import { Odometer, CircleCheck, User, Money } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const plans = ref<any[]>([]);
const stats = ref({ plans: 0, orders: 0, paidOrders: 0, revenueCents: 0, users: 0 });
const cards = computed(() => [
  { label: '今日收入', value: '¥ ' + (stats.value.revenueCents / 100).toFixed(2), note: '已支付订单累计', icon: markRaw(Money), bg: '#e8f5ed', color: '#1f9d61' },
  { label: '套餐数量', value: stats.value.plans, note: '可选付费套餐', icon: markRaw(Odometer), bg: '#e6f1fb', color: '#2f6fce' },
  { label: '注册用户', value: stats.value.users, note: '累计用户', icon: markRaw(User), bg: '#f6edf9', color: '#8a4ec0' },
  { label: '已支付订单', value: stats.value.paidOrders, note: stats.value.orders + ' 总数', icon: markRaw(CircleCheck), bg: '#fef2e5', color: '#d9822b' },
]);

async function load() {
  try {
    const d: any = await req('/admin/dashboard');
    stats.value = { ...stats.value, ...d.stats };
    const p: any = await req('/plans');
    plans.value = p.plans || [];
  } catch (e: any) { ElMessage.error(e.message || '加载失败'); }
}
onMounted(load);
</script>

<style scoped>
.stat-card { background: #fff; border: 1px solid #e8ecf3; border-radius: 14px; padding: 20px; display: flex; gap: 14px; align-items: center; }
.stat-icon { width: 44px; height: 44px; border-radius: 11px; font-size: 22px; display: flex; align-items: center; justify-content: center; }
.stat-body .stat-label { color: #8794a8; font-size: 13px; }
.stat-body .stat-value { display: block; font-size: 24px; font-weight: 600; margin: 4px 0; color: #1c2a44; }
.stat-body .stat-note { color: #a5b0c2; font-size: 12px; font-style: normal; }
.panel { background: #fff; border: 1px solid #e8ecf3; border-radius: 14px; padding: 20px 22px; margin-top: 18px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.panel-head b { font-size: 16px; }
.panel-head span { color: #8794a8; font-size: 13px; }
.overview { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.ov-item { text-align: center; padding: 16px 0; background: #f7f9fd; border-radius: 10px; }
.ov-item span { color: #8794a8; font-size: 13px; }
.ov-item strong { display: block; font-size: 26px; margin-top: 8px; color: #1c2a44; }
</style>
