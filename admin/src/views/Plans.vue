<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <b>套餐与定价</b>
      <el-button type="primary" @click="openEdit()">新增套餐</el-button>
    </div>
    <el-table :data="plans" v-loading="loading" style="width:100%">
      <el-table-column prop="code" label="代码" width="130" />
      <el-table-column prop="name" label="名称" min-width="130" />
      <el-table-column prop="currency" label="币种" width="70" />
      <el-table-column label="价格" width="120"><template #default="{row}">{{ row.price_cents===0?'免费':'¥'+(row.price_cents/100).toFixed(2) }}</template></el-table-column>
      <el-table-column prop="billing_period" label="周期" width="100" />
      <el-table-column prop="upload_quota" label="上传" width="80" />
      <el-table-column prop="download_quota" label="下载" width="80" />
      <el-table-column prop="zip_quota" label="ZIP" width="80" />
      <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.is_active?'success':'info'" size="small">{{ row.is_active?'启用':'停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="danger" @click="toggle(row)">{{ row.is_active?'停用':'启用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialog" :title="form.code?'编辑套餐':'新增套餐'" width="560px">
    <el-form :model="form" label-width="96px">
      <el-form-item label="代码"><el-input v-model="form.code" :disabled="!!form.code" placeholder="如 pro-month" /></el-form-item>
      <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="币种"><el-select v-model="form.currency"><el-option label="CNY ¥" value="CNY"/><el-option label="USD $" value="USD"/><el-option label="EUR €" value="EUR"/></el-select></el-form-item>
      <el-form-item label="价格(分)"><el-input-number v-model="form.price_cents" :min="0" /></el-form-item>
      <el-form-item label="周期"><el-select v-model="form.billing_period"><el-option label="月付" value="month"/><el-option label="年付" value="year"/><el-option label="永久" value="lifetime"/><el-option label="一次性" value="one_time"/></el-select></el-form-item>
      <el-form-item label="上传/下载/ZIP"><el-input-number v-model="form.upload_quota" :min="0" /><span class="sep">/</span><el-input-number v-model="form.download_quota" :min="0" /><span class="sep">/</span><el-input-number v-model="form.zip_quota" :min="0" /></el-form-item>
      <el-form-item label="单次张数"><el-input-number v-model="form.max_items" :min="1" /></el-form-item>
      <el-form-item label="并发"><el-input-number v-model="form.concurrency" :min="1" :max="10" /></el-form-item>
      <el-form-item label="试用(天)"><el-input-number v-model="form.trial_days" :min="0" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage } from 'element-plus';

const plans = ref<any[]>([]);
const loading = ref(false);
const dialog = ref(false);
const form = ref<any>({ code: '', name: '', currency: 'CNY', price_cents: 0, billing_period: 'month', upload_quota: 1, download_quota: 1, zip_quota: 1, max_items: 10, concurrency: 1, trial_days: 0 });

async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/plans'); plans.value = d.plans || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
function openEdit(row?: any) {
  form.value = row ? { ...row } : { code: '', name: '', currency: 'CNY', price_cents: 0, billing_period: 'month', upload_quota: 1, download_quota: 1, zip_quota: 1, max_items: 10, concurrency: 1, trial_days: 0 };
  dialog.value = true;
}
async function save() {
  const isNew = !form.value.code || plans.value.every(p => p.code !== form.value.code);
  const payload = { ...form.value };
  try {
    if (isNew) await req('/admin/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    else await req('/admin/plans/' + form.value.code, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    ElMessage.success('已保存'); dialog.value = false; load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function toggle(row: any) {
  try { await req('/admin/plans/' + row.code, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...row, is_active: !row.is_active }) }); ElMessage.success('已更新'); load(); }
  catch (e: any) { ElMessage.error(e.message); }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.sep { margin: 0 10px; color: #a5b0c2; }
.panel-card { border-radius: 14px; }
</style>
