<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <b>套餐与定价</b>
      <el-button type="primary" @click="openEdit()">新增套餐</el-button>
    </div>
    <el-table :data="plans" v-loading="loading" style="width:100%">
      <el-table-column prop="code" label="代码" width="130" />
      <el-table-column prop="name" label="名称" min-width="130" />
      <el-table-column label="价格(人民币)" width="130"><template #default="{row}"><span>{{ row.priceCents===0 ? '免费' : '¥' + (row.priceCents/100).toFixed(2) }}</span></template></el-table-column><el-table-column prop="billingPeriod" label="周期" width="100" />
      <el-table-column prop="uploadQuota" label="上传" width="80" />
      <el-table-column prop="downloadQuota" label="下载" width="80" />
      <el-table-column prop="zipQuota" label="ZIP" width="80" />
      <el-table-column label="单次上限" width="90"><template #default="{row}">{{ fmtMB(row.maxBytes) }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.isActive?'success':'info'" size="small">{{ row.isActive?'启用':'停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{row}">
          <el-button size="small" type="primary" link @click="openEdit(row)">编辑</el-button>
          <el-button size="small" :type="row.isActive ? 'warning' : 'success'" link @click="toggle(row)">{{ row.isActive ? '停用' : '启用' }}</el-button>
          <el-button size="small" type="danger" link @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialog" :title="form.code?'编辑套餐':'新增套餐'" width="560px">
    <el-form :model="form" label-width="96px">
      <el-form-item label="代码"><el-input v-model="form.code" :disabled="!!form.code" placeholder="如 pro-month" /></el-form-item>
      <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="价格(人民币元)"><el-input-number v-model="form.price" :min="0" :precision="2" :step="1" style="width:180px" /></el-form-item>
      <el-alert type="info" :closable="false" style="margin-bottom:12px" title="价格统一以人民币(元)存储。微信/支付宝按人民币收款；PayPal 等外币渠道按后台「系统设置→汇率换算」自动换算为美元等币种收款。" />
      <el-form-item label="周期"><el-select v-model="form.billingPeriod"><el-option label="月付" value="month"/><el-option label="年付" value="year"/><el-option label="永久" value="lifetime"/><el-option label="一次性" value="one_time"/></el-select></el-form-item>
      <el-form-item label="上传/下载/ZIP"><el-input-number v-model="form.uploadQuota" :min="0" /><span class="sep">/</span><el-input-number v-model="form.downloadQuota" :min="0" /><span class="sep">/</span><el-input-number v-model="form.zipQuota" :min="0" /></el-form-item>
      <el-form-item label="单次张数"><el-input-number v-model="form.maxItems" :min="1" /></el-form-item>
      <el-form-item label="单次大小(MB)"><el-input-number v-model="form.maxBytesMB" :min="0" :step="1" /></el-form-item>
      <el-form-item label="并发"><el-input-number v-model="form.concurrency" :min="1" :max="10" /></el-form-item>
      <el-form-item label="试用(天)"><el-input-number v-model="form.trialDays" :min="0" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';

const plans = ref<any[]>([]);
const loading = ref(false);
const dialog = ref(false);
const emptyForm = () => ({ code: '', name: '', currency: 'CNY', price: 0, billingPeriod: 'month', uploadQuota: 1, downloadQuota: 1, zipQuota: 1, maxItems: 10, maxBytesMB: 200, concurrency: 1, trialDays: 0 });
const form = ref<any>(emptyForm());

async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/plans'); plans.value = d.plans || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
function fmtMB(mb: number) { return (Number(mb) / 1048576).toFixed(0) + ' MB'; }
function openEdit(row?: any) {
  if (row) form.value = { ...row, currency: 'CNY', price: Number(row.priceCents) / 100, maxBytesMB: Math.round(Number(row.maxBytes || 0) / 1048576) };
  else form.value = emptyForm();
  dialog.value = true;
}
async function save() {
  const isNew = !form.value.code || plans.value.every(p => p.code !== form.value.code);
  const { maxBytesMB, price, ...rest } = form.value;
  // 价格统一以人民币元填写，后端以"分"存储；外币渠道由后端按汇率自动换算
  const payload = { ...rest, currency: 'CNY', priceCents: Math.round(Number(price || 0) * 100), maxBytes: Math.round(Number(maxBytesMB || 0) * 1048576) };
  try {
    if (isNew) await req('/admin/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    else await req('/admin/plans/' + form.value.code, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    ElMessage.success('已保存'); dialog.value = false; load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function toggle(row: any) {
  try {
    const payload = { ...row, isActive: !row.isActive };
    await req('/admin/plans/' + row.code, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    ElMessage.success('已' + (row.isActive ? '停用' : '启用'));
    load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function remove(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除套餐「${row.name}」吗？\n若该套餐已有订单/订阅记录，将自动改为下架（不再对用户展示）。`,
      '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch { return; }
  try {
    const d: any = await req('/admin/plans/' + row.code, { method: 'DELETE' });
    if (d.deactivated) {
      ElMessage.warning(d.message || '该套餐已有订单/订阅，已自动下架');
    } else if (d.deleted) {
      ElMessage.success('已删除');
    } else {
      ElMessage.warning(d.message || '未删除');
    }
    load();
  } catch (e: any) { ElMessage.error(e.message); }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.sep { margin: 0 10px; color: #a5b0c2; }
.panel-card { border-radius: 14px; }
</style>
