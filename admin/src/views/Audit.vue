<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar"><b>审计日志</b><el-button @click="load">刷新</el-button></div>
    <el-table :data="logs" v-loading="loading" style="width:100%">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="actor" label="操作者" width="170" />
      <el-table-column prop="action" label="动作" min-width="200" />
      <el-table-column prop="target_type" label="对象" width="110" />
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column label="时间" width="180"><template #default="{row}">{{ fmt(row.created_at) }}</template></el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage } from 'element-plus';
const logs = ref<any[]>([]);
const loading = ref(false);
function fmt(t: string) { return t ? new Date(t).toLocaleString('zh-CN', { hour12:false }) : '-'; }
async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/audit-logs?limit=200'); logs.value = d.logs || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.panel-card { border-radius: 14px; }
</style>
