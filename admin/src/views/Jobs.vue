<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <div><b>中转与 ZIP 任务</b><span>监控服务端抓取与打包任务的运行状况</span></div>
      <el-button @click="load">刷新</el-button>
    </div>
    <el-table :data="jobs" v-loading="loading" style="width:100%">
      <el-table-column prop="jobNo" label="任务号" width="180" />
      <el-table-column prop="userEmail" label="用户" min-width="160" />
      <el-table-column prop="fileCount" label="文件数" width="90" />
      <el-table-column prop="totalBytes" label="总大小" width="100"><template #default="{row}">{{ fmtBytes(row.totalBytes) }}</template></el-table-column>
      <el-table-column label="状态" width="110"><template #default="{row}"><el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="创建时间" width="180"><template #default="{row}">{{ fmt(row.created_at) }}</template></el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{row}">
          <el-button size="small" text type="primary" @click="copyUrl(row)">复制链接</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !jobs.length" description="暂无中转任务" />
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage } from 'element-plus';

const jobs = ref<any[]>([]);
const loading = ref(false);
function statusText(s: string) { const m: Record<string,string> = { queued:'排队中', running:'处理中', completed:'已完成', failed:'失败', expired:'已过期', cancelled:'已取消' }; return m[s]||s; }
function statusType(s: string) { return s==='completed'?'success':s==='running'?'warning':s==='failed'?'danger':'info'; }
function fmt(t: string) { return t ? new Date(t).toLocaleString('zh-CN', { hour12:false }) : '-'; }
function fmtBytes(b: number) { if (!b) return '0 B'; const u = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(1)+' '+u[i]; }
async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/zip-jobs?limit=100'); jobs.value = d.jobs || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
async function copyUrl(row: any) {
  if (!row.download_url) return ElMessage.warning('该任务暂无下载链接');
  try { await navigator.clipboard.writeText(row.download_url); ElMessage.success('已复制'); }
  catch { ElMessage.warning('复制失败'); }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.toolbar b { font-size: 16px; }
.toolbar span { color: #8794a8; font-size: 13px; margin-left: 8px; }
.panel-card { border-radius: 14px; min-height: 420px; }
</style>
