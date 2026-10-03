<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常；复核待办由共用审核规则统一计算。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">审核 / 复核待办（与各业务入口实时同步）</h3>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>待审核</th><th>待复核</th><th>合计待办</th></tr>
      </thead>
      <tbody>
        <tr v-for="todo in reviewTodos" :key="todo.key">
          <td>{{ todo.name }}</td>
          <td>{{ todo.awaitingReview }}</td>
          <td>{{ todo.awaitingRecheck }}</td>
          <td>{{ todo.awaitingReview + todo.awaitingRecheck }}</td>
        </tr>
        <tr v-if="!reviewTodos.length">
          <td colspan="4" class="empty-state">暂无接入共用审核规则的模块</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">全部模块</h3>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据；历史记录按 schema 版本自动迁移</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { useReviewStore } from '@/stores/review'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const reviewStore = useReviewStore()
reviewStore.bind()
// 复核待办直接走共用 store：任意入口动作落地后这里自动同步，无需手动刷新。
const reviewTodos = reviewStore.todos

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(refresh)
</script>
