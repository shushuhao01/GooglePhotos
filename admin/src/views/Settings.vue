<template>
  <div>
    <el-alert type="info" :closable="false" style="margin-bottom:16px" title="配置公告、维护开关与站点信息，扩展端与公开页面会同步展示。" />
    <el-card shadow="never" class="panel-card">
      <div class="toolbar"><b>公告</b><el-button @click="saveConfig('announcement', announcement)">保存</el-button></div>
      <el-form label-position="top">
        <el-form-item label="公告标题"><el-input v-model="announcement.title" /></el-form-item>
        <el-form-item label="公告内容"><el-input v-model="announcement.content" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="announcement.enabled" /></el-form-item>
      </el-form>
    </el-card>
    <el-card shadow="never" class="panel-card" style="margin-top:16px">
      <div class="toolbar"><b>维护开关</b><el-button @click="saveConfig('maintenance', maintenance)">保存</el-button></div>
      <el-form label-position="top">
        <el-form-item label="启用维护模式"><el-switch v-model="maintenance.enabled" /></el-form-item>
        <el-form-item label="维护提示"><el-input v-model="maintenance.message" /></el-form-item>
      </el-form>
    </el-card>
    <el-card shadow="never" class="panel-card" style="margin-top:16px">
      <div class="toolbar"><b>站点信息</b><el-button @click="saveConfig('site', site)">保存</el-button></div>
      <el-form label-position="top">
        <el-form-item label="客服邮箱"><el-input v-model="site.supportEmail" /></el-form-item>
        <el-form-item label="官网"><el-input v-model="site.website" /></el-form-item>
      </el-form>
    </el-card>
    <el-card shadow="never" class="panel-card" style="margin-top:16px">
      <div class="toolbar"><b>管理员邮箱</b><el-button @click="saveAdmins">保存<br>● 列表内邮箱登录即为管理员</el-button></div>
      <el-alert type="warning" :closable="false" style="margin-bottom:12px" title="在此添加的管理员邮箱可登录管理后台（无需改服务器 .env）" />
      <template v-for="(mail, i) in adminEmails" :key="i">
        <div class="admin-row">
          <el-input v-model="adminEmails[i]" placeholder="管理员邮箱，如 hfyouqian3@gmail.com" style="flex:1" />
          <el-button type="danger" text @click="adminEmails.splice(i,1)">删除</el-button>
        </div>
      </template>
      <el-button style="margin-top:12px" @click="adminEmails.push('')" :icon="()=>null">+ 添加管理员邮箱</el-button>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { req } from '../api';
import { ElMessage } from 'element-plus';

const announcement = ref<any>({ title: '', content: '', enabled: false });
const maintenance = ref<any>({ enabled: false, message: '系统维护中' });
const site = ref<any>({ supportEmail: '', website: '' });
const adminEmails = ref<string[]>([]);

async function load() {
  try {
    const d: any = await req('/admin/system-configs');
    for (const c of d.configs || []) {
      if (c.config_key === 'announcement') announcement.value = c.value;
      if (c.config_key === 'maintenance') maintenance.value = c.value;
      if (c.config_key === 'site') site.value = c.value;
    }
  } catch (e: any) { ElMessage.error(e.message); }
  try {
    const d: any = await req('/admin/admin-emails');
    adminEmails.value = d.emails || [];
  } catch (e: any) { /* 接口暂不可用时不阻塞 */ }
}
async function saveConfig(key: string, value: any) {
  try { await req('/admin/system-configs/' + key, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) }); ElMessage.success('已保存'); }
  catch (e: any) { ElMessage.error(e.message); }
}
async function saveAdmins() {
  const emails = adminEmails.value.map(s => s.trim()).filter(Boolean);
  try { await req('/admin/admin-emails', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails }) }); ElMessage.success('管理员邮箱已保存'); }
  catch (e: any) { ElMessage.error(e.message); }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.panel-card { border-radius: 14px; }
.admin-row { display: flex; gap: 8px; margin-bottom: 8px; }
</style>
