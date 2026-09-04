<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">◫</div>
      <h2>Web Image Uploader 管理后台</h2>
      <p class="sub">请输入管理员邮箱登录（开发阶段）</p>
      <el-form @submit.prevent>
        <el-form-item>
          <el-input v-model="email" placeholder="管理员邮箱" size="large" @keyup.enter="doLogin" />
        </el-form-item>
        <el-button type="primary" size="large" class="login-btn" :loading="auth.loginLoading" @click="doLogin">登录</el-button>
      </el-form>
      <div class="tip">生产环境请配置 ADMIN_EMAIL 并使用正式认证；当前开发接口在 NODE_ENV=production 时自动关闭。</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ElMessage } from 'element-plus';

const email = ref('');
const auth = useAuthStore();
const router = useRouter();
async function doLogin() {
  if (!email.value.trim()) return ElMessage.warning('请输入管理员邮箱');
  try {
    await auth.login(email.value.trim());
    ElMessage.success('登录成功');
    router.push('/dashboard');
  } catch (e: any) { ElMessage.error(e.message || '登录失败'); }
}
</script>

<style scoped>
.login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 30% 20%, #1d3a6b, #0d1830 65%); }
.login-card { width: 380px; background: #fff; border-radius: 16px; padding: 40px 36px; box-shadow: 0 18px 50px rgba(0,0,0,.25); }
.login-logo { width: 60px; height: 60px; border-radius: 16px; background: linear-gradient(135deg,#4f8cff,#2259c4); color: #fff; font-size: 30px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
h2 { text-align: center; font-size: 20px; margin: 0 0 6px; color: #1c2a44; }
.sub { text-align: center; color: #8a97ab; font-size: 13px; margin: 0 0 26px; }
.login-btn { width: 100%; }
.tip { margin-top: 24px; padding: 12px 14px; background: #f2f5fb; border-radius: 8px; color: #8a97ab; font-size: 12px; line-height: 1.6; }
</style>
