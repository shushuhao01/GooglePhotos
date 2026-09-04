<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <b>订单与支付</b>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-table :data="orders" v-loading="loading" style="width:100%">
      <el-table-column prop="order_no" label="订单号" width="180" />
      <el-table-column prop="provider" label="渠道" width="90" />
      <el-table-column label="金额" width="110"><template #default="{row}">¥{{ (row.amount_cents/100).toFixed(2) }}</template></el-table-column>
      <el-table-column label="状态" width="110"><template #default="{row}"><el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag></template></el-table-column>
      <el-table-column prop="provider_trade_no" label="渠道交易号" min-width="150" />
      <el-table-column label="支付时间" width="170"><template #default="{row}">{{ fmt(row.paid_at) }}</template></el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="replay(row)">查单</el-button>
          <el-button size="small" type="danger" :disabled="row.status!=='paid'" @click="refund(row)">退款</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';

const orders = ref<any[]>([]);
const loading = ref(false);
function statusText(s: string) { const m: Record<string,string> = { pending:'待支付', paid:'已支付', failed:'失败', refunded:'已退款', expired:'已过期', partially_refunded:'部分退款' }; return m[s]||s; }
function statusType(s: string) { return s==='paid'?'success':s==='pending'?'warning':s==='refunded'?'info':'danger'; }
function fmt(t: string) { return t ? new Date(t).toLocaleString('zh-CN', { hour12:false }) : '-'; }
async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/orders?limit=100'); orders.value = d.orders || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
async function replay(row: any) {
  try { await req('/admin/orders/' + row.order_no + '/replay', { method: 'POST' }); ElMessage.success('已主动查单'); load(); }
  catch (e: any) { ElMessage.error(e.message); }
}
async function refund(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('退款金额(分，默认全额=' + row.amount_cents + ')', '退款', { inputValue: String(row.amount_cents) });
    await req('/admin/orders/' + row.order_no + '/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cents: Number(value) || row.amount_cents }) });
    ElMessage.success('已退款'); load();
  } catch (e: any) { if (e !== 'cancel') ElMessage.error(e.message); }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.panel-card { border-radius: 14px; }
</style>
