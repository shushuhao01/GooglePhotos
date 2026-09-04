<template>
  <div>
    <el-alert type="info" :closable="false" style="margin-bottom:16px" title="配置并测试支付渠道：支付宝/微信/PayPal 需填写真实商户配置后保存，点击「测试连接」验证是否可用。敏感密钥将加密存储。" />
    <div class="toolbar">
      <b>支付渠道配置</b>
      <el-button type="primary" @click="openAdd">新增渠道</el-button>
    </div>

    <div class="channel-grid">
      <el-card v-for="c in channels" :key="c.provider" shadow="never" class="channel-card">
        <div class="channel-head">
          <div class="channel-title">
            <el-icon class="ch-icon" :style="{background:iconBg(c.provider), color:iconColor(c.provider)}"><component :is="iconOf(c.provider)" /></el-icon>
            <div><b>{{ nameOf(c.provider) }}</b><small>{{ descOf(c.provider) }}</small></div>
          </div>
          <el-switch v-model="c.enabled" @change="saveChannel(c)" />
        </div>
        <el-form label-position="top" size="small">
          <template v-for="f in fieldsOf(c.provider)" :key="f.key">
            <el-form-item :label="f.label">
              <el-input :type="f.type||'text'" v-model="c.fields[f.key]" :placeholder="f.placeholder||''" :show-password="f.type==='password'" />
            </el-form-item>
          </template>
        </el-form>
        <div class="channel-actions">
          <el-button type="primary" size="small" @click="saveChannel(c)">保存配置</el-button>
          <el-button size="small" @click="testChannel(c)" :loading="c.testing">测试连接</el-button>
        </div>
        <div v-if="c.testResult" class="test-result">
          <el-alert :type="c.testResult.success?'success':'error'" :title="c.testResult.message" :closable="false" />
          <ul v-if="c.testResult.items && c.testResult.items.length" class="test-items">
            <li v-for="it in c.testResult.items" :key="it.name">
              <span :class="it.status?'ok':'bad'">{{ it.status?'✓':'✗' }}</span> {{ it.name }} <em>{{ it.message }}</em>
            </li>
          </ul>
        </div>
      </el-card>
    </div>

    <!-- 新增渠道对话框 -->
    <el-dialog v-model="addDialog" title="新增渠道" width="440px">
      <p style="color:#8794a8;font-size:13px;margin:0 0 14px">选择要接入的支付渠道（仅支持后端已实现的类型）：</p>
      <el-form label-width="90px">
        <el-form-item label="渠道类型">
          <el-select v-model="addProvider" style="width:100%">
            <el-option v-for="p in availableProviders" :key="p" :label="nameOf(p) + '（' + descOf(p) + '）'" :value="p" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialog=false">取消</el-button>
        <el-button type="primary" @click="doAdd">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, markRaw, computed } from 'vue';
import { req } from '../api';
import { ElMessage } from 'element-plus';
import { CreditCard, Money, Iphone, Wallet } from '@element-plus/icons-vue';

interface Channel { provider: string; enabled: boolean; fields: Record<string,string>; testing?: boolean; testResult?: any; }
const channels = ref<Channel[]>([]);
const addDialog = ref(false);
const addProvider = ref('');
const ALL_PROVIDERS = ['mock', 'wechat', 'alipay', 'paypal'];

const meta: Record<string, { name: string; desc: string; icon: any; bg: string; color: string; fields: { key: string; label: string; type?: string; placeholder?: string }[] }> = {
  mock: { name: 'Mock 支付', desc: '开发阶段验证流程', icon: markRaw(CreditCard), bg: '#eef1f6', color: '#5f6b7d', fields: [] },
  alipay: { name: '支付宝', desc: '当面付/扫码 + WAP 手机网站', icon: markRaw(Money), bg: '#e8f5ec', color: '#1a9e6a', fields: [
    { key: 'appId', label: 'AppID', placeholder: '开放平台 AppID' },
    { key: 'privateKey', label: '应用私钥(应用私钥PEM)', type: 'textarea', placeholder: '-------应用私钥----' },
    { key: 'alipayPublicKey', label: '支付宝公钥', type: 'textarea', placeholder: '-------支付宝公钥----' },
    { key: 'notifyUrl', label: '异步通知地址(可选，默认自动生成)' },
    { key: 'payMethod', label: '支付方式', placeholder: 'precreate(扫码) 或 wap' },
  ] },
  wechat: { name: '微信支付', desc: 'Native 扫码 / H5 跳转 (APIv3)', icon: markRaw(Iphone), bg: '#e7f3ec', color: '#0f9d58', fields: [
    { key: 'appid', label: 'AppID', placeholder: '公众号/应用 AppID' },
    { key: 'mchid', label: '商户号 mchid' },
    { key: 'serialNo', label: 'API 证书序列号' },
    { key: 'apiV3Key', label: 'APIv3 密钥(32位)', type: 'password' },
    { key: 'merchantPrivateKey', label: '商户 API 私钥 PEM', type: 'textarea', placeholder: '-----BEGIN PRIVATE KEY-----' },
    { key: 'notifyUrl', label: '异步通知地址(可选，默认自动生成)' },
    { key: 'method', label: '支付方式', placeholder: 'native(扫码) 或 h5' },
  ] },
  paypal: { name: 'PayPal', desc: '国际卡 & PayPal 钱包', icon: markRaw(Wallet), bg: '#eaf0f9', color: '#3166c0', fields: [
    { key: 'clientId', label: 'Client ID', placeholder: 'PayPal app Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password', placeholder: 'PayPal app Secret' },
    { key: 'environment', label: '环境', placeholder: 'sandbox 或 live' },
    { key: 'webhookId', label: 'Webhook ID(可选，严格验签)', placeholder: 'PayPal Webhook 的 ID，填了才校验回调签名' },
    { key: 'notifyUrl', label: 'Webhook 地址(可选)' },
  ] },
};

function nameOf(p: string) { return meta[p]?.name || p; }
function descOf(p: string) { return meta[p]?.desc || ''; }
function iconOf(p: string) { return meta[p]?.icon || CreditCard; }
function iconBg(p: string) { return meta[p]?.bg || '#eef1f6'; }
function iconColor(p: string) { return meta[p]?.color || '#5f6b7d'; }
function fieldsOf(p: string) { return meta[p]?.fields || []; }

async function load() {
  try {
    const d: any = await req('/admin/payment-channels');
    const existing = d.channels.map((c: any) => ({ provider: c.provider, enabled: !!c.enabled, fields: {} }));
    // 若后端还没存任何渠道，则展示全部可支持渠道（默认 mock 关闭态），便于一次性配置
    const providers = existing.length ? existing : ALL_PROVIDERS.map((p) => ({ provider: p, enabled: false, fields: {} }));
    channels.value = providers;
  } catch (e: any) { ElMessage.error(e.message); }
}
const availableProviders = computed(() => {
  const existing = channels.value.map((c) => c.provider);
  return ALL_PROVIDERS.filter((p) => !existing.includes(p));
});
function openAdd() {
  if (!availableProviders.value.length) { ElMessage.warning('所有支持的渠道已添加'); return; }
  addProvider.value = availableProviders.value[0];
  addDialog.value = true;
}
async function doAdd() {
  if (!addProvider.value) return;
  channels.value.push({ provider: addProvider.value, enabled: false, fields: {} });
  addDialog.value = false;
  ElMessage.success('已添加 ' + nameOf(addProvider.value) + '，请填写配置后保存');
}
async function saveChannel(c: Channel) {
  try { await req('/admin/payment-channels/' + c.provider, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: c.enabled, config: c.fields }) }); ElMessage.success('已保存 ' + c.provider); }
  catch (e: any) { ElMessage.error(e.message); }
}
async function testChannel(c: Channel) {
  c.testing = true;
  try { const d: any = await req('/admin/payment-channels/' + c.provider + '/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.fields) }); c.testResult = d; }
  catch (e: any) { c.testResult = { success: false, message: e.message, items: [] }; }
  finally { c.testing = false; }
}
onMounted(load);
</script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.toolbar b { font-size: 16px; }
.channel-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
.channel-card { border-radius: 14px; border: 1px solid #e8ecf3; }
.channel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
.channel-title { display: flex; gap: 10px; align-items: center; }
.channel-title b { font-size: 15px; display: block; }
.channel-title small { color: #8794a8; font-size: 12px; }
.ch-icon { width: 34px; height: 34px; border-radius: 9px; font-size: 18px; display: flex; align-items: center; justify-content: center; color: #fff; }
.channel-actions { margin-top: 6px; display: flex; gap: 10px; }
.test-result { margin-top: 14px; }
.test-items { list-style: none; padding: 0; margin: 10px 0 0; }
.test-items li { font-size: 12px; color: #4d5a6e; line-height: 2; }
.test-items .ok { color: #16a34a; }
.test-items .bad { color: #dc2626; }
.test-items em { color: #98a3b5; font-style: normal; margin-left: 6px; }
</style>
