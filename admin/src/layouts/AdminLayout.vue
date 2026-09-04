<template>
  <el-container class="layout">
    <el-aside width="230px" class="aside">
      <div class="brand">
        <div class="brand-logo">◫</div>
        <div class="brand-text">
          <b>Web Image Uploader</b>
          <small>收费管理后台</small>
        </div>
      </div>
      <el-menu :default-active="$route.path" router class="menu" background-color="transparent">
        <el-menu-item index="/dashboard"><el-icon><Odometer /></el-icon><span>仪表盘</span></el-menu-item>
        <el-menu-item index="/users"><el-icon><User /></el-icon><span>用户与额度</span></el-menu-item>
        <el-menu-item index="/plans"><el-icon><Goods /></el-icon><span>套餐与定价</span></el-menu-item>
        <el-menu-item index="/orders"><el-icon><List /></el-icon><span>订单与支付</span></el-menu-item>
        <el-menu-item index="/channels"><el-icon><CreditCard /></el-icon><span>支付渠道</span></el-menu-item>
        <el-menu-item index="/jobs"><el-icon><FolderOpened /></el-icon><span>中转与 ZIP</span></el-menu-item>
        <el-menu-item index="/audit"><el-icon><Document /></el-icon><span>审计日志</span></el-menu-item>
        <el-menu-item index="/risk"><el-icon><Warning /></el-icon><span>风控规则</span></el-menu-item>
        <el-menu-item index="/settings"><el-icon><Setting /></el-icon><span>系统设置</span></el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-title">
          <h1>{{ title }}</h1>
          <p>统一管理用户、额度、订单、支付渠道与中转任务</p>
        </div>
        <div class="header-actions">
          <el-tag type="success" effect="light">● 服务正常</el-tag>
          <el-dropdown @command="onCommand">
            <span class="user-chip">
              <el-avatar size="small">{{ (auth.email || 'A').slice(0,1).toUpperCase() }}</el-avatar>
              {{ auth.email || '未登录' }}
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { Odometer, User, Goods, List, CreditCard, FolderOpened, Document, Warning, Setting, ArrowDown } from '@element-plus/icons-vue';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const titles: Record<string, string> = {
  '/dashboard': '仪表盘', '/users': '用户与额度', '/plans': '套餐与定价',
  '/orders': '订单与支付', '/channels': '支付渠道', '/jobs': '中转与 ZIP',
  '/audit': '审计日志', '/risk': '风控规则', '/settings': '系统设置',
};
const title = computed(() => titles[route.path] || '管理');
function onCommand(c: string) {
  if (c === 'logout') { auth.logout(); router.push('/login'); }
}
</script>

<style scoped>
.layout { min-height: 100vh; }
.aside { background: #10182b; color: #c7d2e5; display: flex; flex-direction: column; }
.brand { display: flex; gap: 12px; align-items: center; padding: 22px 20px 26px; }
.brand-logo { font-size: 28px; color: #4f8cff; }
.brand-text b { display: block; color: #fff; font-size: 15px; }
.brand-text small { display: block; color: #8a9bb8; margin-top: 3px; font-size: 12px; }
.menu { border-right: none; }
.menu :deep(.el-menu-item) { color: #b6c3d8; height: 46px; line-height: 46px; margin: 2px 10px; border-radius: 8px; }
.menu :deep(.el-menu-item:hover) { background: #1c2942; color: #fff; }
.menu :deep(.el-menu-item.is-active) { background: #22406f; color: #fff; }
.header { background: #fff; border-bottom: 1px solid #e8ecf3; display: flex; align-items: center; justify-content: space-between; padding: 0 26px; height: 76px; }
.header-title h1 { margin: 0; font-size: 22px; font-weight: 600; }
.header-title p { margin: 6px 0 0; color: #8794a8; font-size: 13px; }
.header-actions { display: flex; gap: 18px; align-items: center; }
.user-chip { display: flex; align-items: center; gap: 8px; cursor: pointer; color: #3d4a5d; font-size: 14px; }
.main { background: #f4f6fb; padding: 24px 26px; }
</style>
