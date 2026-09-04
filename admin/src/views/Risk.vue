<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <div><b>风控规则</b><span>IP/账号/设备限流、异常任务与批量注册检测</span></div>
      <el-button type="primary" @click="openEdit()">新增规则</el-button>
    </div>
    <el-table :data="rules" v-loading="loading" style="width:100%">
      <el-table-column prop="key" label="规则键" width="150" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column prop="ruleType" label="类型" width="130" />
      <el-table-column prop="value" label="阈值" width="90" />
      <el-table-column prop="windowSeconds" label="窗口(秒)" width="100" />
      <el-table-column prop="action" label="动作" min-width="120" />
      <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.enabled?'success':'info'" size="small">{{ row.enabled?'启用':'停用' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" type="warning" @click="toggle(row)">{{ row.enabled?'停用':'启用' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dialog" :title="form.key?'编辑规则':'新增规则'" width="480px">
    <el-form :model="form" label-width="90px">
      <el-form-item label="规则键"><el-input v-model="form.key" :disabled="!!form.key" placeholder="如 ip_limit / register-rate" /></el-form-item>
      <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
      <el-form-item label="类型"><el-select v-model="form.ruleType"><el-option label="IP限流" value="ip"/><el-option label="接口限流" value="rate_limit"/><el-option label="任务频率" value="task_rate"/><el-option label="批量注册" value="register"/></el-select></el-form-item>
      <el-form-item label="阈值"><el-input-number v-model="form.value" :min="0" /></el-form-item>
      <el-form-item label="窗口(秒)"><el-input-number v-model="form.windowSeconds" :min="1" /></el-form-item>
      <el-form-item label="动作"><el-input v-model="form.action" placeholder="如 block / warn" /></el-form-item>
      <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dialog=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage } from 'element-plus';

const rules = ref<any[]>([]);
const loading = ref(false);
const dialog = ref(false);
const form = ref<any>({ key: '', name: '', ruleType: 'ip', value: 0, windowSeconds: 60, enabled: true, action: '' });

async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/risk-rules'); rules.value = d.rules || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
function openEdit(row?: any) {
  if (row) form.value = { ...row };
  else form.value = { key: '', name: '', ruleType: 'ip', value: 0, windowSeconds: 60, enabled: true, action: '' };
  dialog.value = true;
}
async function save() {
  const isNew = !form.value.key || rules.value.every(r => r.key !== form.value.key);
  const payload = { key: form.value.key, name: form.value.name, ruleType: form.value.ruleType, value: Number(form.value.value), windowSeconds: Number(form.value.windowSeconds), enabled: !!form.value.enabled, action: form.value.action || '' };
  try {
    if (isNew) await req('/admin/risk-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    else await req('/admin/risk-rules/' + form.value.key, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !!form.value.enabled }) });
    ElMessage.success('已保存'); dialog.value = false; load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function toggle(row: any) {
  try { await req('/admin/risk-rules/' + row.key, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !row.enabled }) }); ElMessage.success('已更新'); load(); }
  catch (e: any) { ElMessage.error(e.message); }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.toolbar span { color: #8794a8; font-size: 13px; margin-left: 8px; }
.panel-card { border-radius: 14px; }
</style>
