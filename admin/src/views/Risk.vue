<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar"><b>风控规则</b><span>IP/账号/设备限流、异常任务与批量注册检测</span></div>
    <el-table :data="rules" v-loading="loading" style="width:100%">
      <el-table-column prop="key" label="规则键" width="140" />
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column prop="rule_type" label="类型" width="130" />
      <el-table-column prop="value" label="阈值" width="90" />
      <el-table-column prop="window_seconds" label="窗口(秒)" width="100" />
      <el-table-column label="状态" width="90"><template #default="{row}"><el-tag :type="row.enabled?'success':'info'" size="small">{{ row.enabled?'启用':'停用' }}</el-tag></template></el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage } from 'element-plus';
const rules = ref<any[]>([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/risk-rules'); rules.value = d.rules || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.toolbar span { color: #8794a8; font-size: 13px; }
.panel-card { border-radius: 14px; }
</style>
