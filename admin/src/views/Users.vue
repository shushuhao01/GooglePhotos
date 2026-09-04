<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索邮箱" clearable style="width:280px" />
      <el-button type="primary" @click="load">刷新</el-button>
    </div>
    <el-table :data="filteredUsers" v-loading="loading" style="width:100%">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="邮箱" min-width="200"><template #default="{row}">{{ row.email }}</template></el-table-column>
      <el-table-column prop="display_name" label="昵称" width="140" />
      <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.status==='active'?'success':row.status==='blocked'?'danger':'info'" size="small">{{ statusText(row.status) }}</el-tag></template></el-table-column>
      <el-table-column label="管理员" width="100"><template #default="{row}"><el-tag v-if="row.isAdmin" type="warning" size="small">管理员</el-tag><span v-else style="color:#aaa">普通</span></template></el-table-column>
      <el-table-column label="创建时间" width="170"><template #default="{row}">{{ fmt(row.createdAt) }}</template></el-table-column>
      <el-table-column label="操作" width="320" fixed="right">
        <template #default="{row}">
          <el-button size="small" @click="showDetail(row)">详情</el-button>
          <el-button size="small" type="warning" @click="grant(row)">发额度</el-button>
          <el-button size="small" type="success" @click="toggleAdmin(row)">{{ row.isAdmin ? '取消管理员' : '设为管理员' }}</el-button>
          <el-button size="small" type="danger" @click="toggleBlock(row)">{{ row.status==='blocked'?'解封':'封禁' }}</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';

const users = ref<any[]>([]);
const keyword = ref('');
const loading = ref(false);
const filteredUsers = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  return k ? users.value.filter(u => (u.email || '').toLowerCase().includes(k)) : users.value;
});
function statusText(s: string) { return s === 'active' ? '正常' : s === 'blocked' ? '已封禁' : '已删除'; }
function fmt(t: string) { return t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-'; }

async function load() {
  loading.value = true;
  try { const d: any = await req('/admin/users?limit=100'); users.value = d.users || []; }
  catch (e: any) { ElMessage.error(e.message); } finally { loading.value = false; }
}
async function showDetail(row: any) {
  try { const d: any = await req('/admin/users/' + row.id); ElMessageBox.alert(JSON.stringify(d.subscriptions || [], null, 2), '订阅与订单', { dangerouslyUseHTMLString: false }); }
  catch (e: any) { ElMessage.error(e.message); }
}
async function grant(row: any) {
  try { const { value } = await ElMessageBox.prompt('输入套餐代码（如 pro-month / pro-year / lifetime）', '发放额度'); await req('/admin/users/' + row.id + '/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planCode: value }) }); ElMessage.success('已发放'); load(); }
  catch (e: any) { if (e !== 'cancel') ElMessage.error(e.message); }
}
async function toggleBlock(row: any) {
  try {
    const status = row.status === 'blocked' ? 'active' : 'blocked';
    await req('/admin/users/' + row.id + '/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    ElMessage.success('已更新'); load();
  } catch (e: any) { ElMessage.error(e.message); }
}
async function toggleAdmin(row: any) {
  try {
    const isAdmin = !row.isAdmin;
    await req('/admin/users/' + row.id + '/admin', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isAdmin }) });
    ElMessage.success(isAdmin ? '已设为管理员' : '已取消管理员'); load();
  } catch (e: any) { ElMessage.error(e.message); }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
.panel-card { border-radius: 14px; }
</style>
