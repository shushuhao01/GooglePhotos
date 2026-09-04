<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">◫</div>
      <h2>Web Image Uploader 管理后台</h2>
      <p class="sub">管理员账号登录</p>

      <el-tabs v-model="tab" stretch>
        <el-tab-pane label="管理员账号" name="cred">
          <el-form @submit.prevent>
            <el-form-item>
              <el-input v-model="username" placeholder="管理员账号" size="large" @keyup.enter="doCredLogin">
                <template #prefix><el-icon><User /></el-icon></template>
              </el-input>
            </el-form-item>
            <el-form-item>
              <el-input v-model="password" type="password" placeholder="请输入密码" size="large" show-password @keyup.enter="doCredLogin">
                <template #prefix><el-icon><Lock /></el-icon></template>
              </el-input>
            </el-form-item>
            <el-button type="primary" size="large" class="login-btn" :loading="auth.loginLoading" @click="doCredLogin">登录</el-button>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="管理员邮箱" name="email">
          <el-form @submit.prevent>
            <el-form-item>
              <el-input v-model="email" placeholder="管理员邮箱" size="large" @keyup.enter="doEmailLogin">
                <template #prefix><el-icon><Message /></el-icon></template>
              </el-input>
            </el-form-item>
            <el-button type="primary" size="large" class="login-btn" :loading="auth.loginLoading" @click="doEmailLogin">登录</el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>

      <div class="tip">
        管理员账号与密码请在「系统设置 → 管理员账号」中查看或修改。<br>
        管理员邮箱登录需在「系统设置 → 管理员邮箱」中配置，修改后需退出重新登录。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import { ElMessage } from 'element-plus';
import { User, Lock, Message } from '@element-plus/icons-vue';

const tab = ref('cred');
const username = ref('');
const password = ref('');
const email = ref('');
const auth = useAuthStore();
const router = useRouter();

async function doCredLogin() {
  if (!username.value.trim()) return ElMessage.warning('请输入管理员账号');
  if (!password.value) return ElMessage.warning('请输入密码');
  try {
    await auth.adminLogin(username.value.trim(), password.value);
    ElMessage.success('登录成功');
    router.push('/dashboard');
  } catch (e: any) { ElMessage.error(e.message || '登录失败'); }
}
async function doEmailLogin() {
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
.login-card { width: 400px; background: #fff; border-radius: 16px; padding: 40px 36px; box-shadow: 0 18px 50px rgba(0,0,0,.25); }
.login-logo { width: 60px; height: 60px; border-radius: 16px; background: linear-gradient(135deg,#4f8cff,#2259c4); color: #fff; font-size: 30px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
h2 { text-align: center; font-size: 20px; margin: 0 0 6px; color: #1c2a44; }
.sub { text-align: center; color: #8a97ab; font-size: 13px; margin: 0 0 26px; }
.login-btn { width: 100%; }
.tip { margin-top: 24px; padding: 12px 14px; background: #f2f5fb; border-radius: 8px; color: #8a97ab; font-size: 12px; line-height: 1.7; }
.tip b { color: #31599c; }
</style>
