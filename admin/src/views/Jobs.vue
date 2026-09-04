<template>
  <el-card shadow="never" class="panel-card">
    <div class="toolbar"><b>中转与 ZIP 任务</b><span>监控服务端抓取与打包任务的运行状况</span></div>
    <el-empty description="暂无中转任务；接入扩展端服务端中转后此处显示实时任务" />
  </el-card>
</template>

<script setup lang="ts"></script>

<style scoped>
.toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
.toolbar b { font-size: 16px; }
.toolbar span { color: #8794a8; font-size: 13px; }
.panel-card { border-radius: 14px; min-height: 420px; }
</style>
