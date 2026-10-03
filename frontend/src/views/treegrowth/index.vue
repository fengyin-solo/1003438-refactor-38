<template>
  <section class="page" data-module="treegrowth">
    <header class="page-head">
      <div>
        <h2>林木生长管理</h2>
        <p class="page-desc">维护林木生长记录，围绕记录编号、样地编号、林分类型、平均胸径做登记、筛选与状态流转；审核、复核、归档共用一份审核规则。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记林木生长记录</button>
        <button class="btn" type="button" @click="exportRows">导出林木生长清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="actionsFor(row).length">
              <button
                v-for="action in actionsFor(row)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="muted-text">流程结束</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无林木生长数据，可先登记林木生长记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条林木生长记录 · 复核待办与运营概览、侧栏角标实时同步</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  reviewSummary,
  runAction as applyAction,
} from '@/api/local-service'
import { availableActions, currentMonth } from '@/domain/review'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('treegrowth')
// 调查结论作为复核提交时的登记项，不占用表格列；记录状态与「当前状态」列重复，跳过。
const columns = meta.fields.filter((field) => field !== '调查结论' && field !== '记录状态')
const filterFields = ['记录编号', '样地编号', '林分类型']
const month = currentMonth()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const summary = computed(() => reviewSummary(meta.key, month))

const statsCards = computed(() => [
  { label: '样地数量（按样地编号去重）', value: summary.value.plots },
  { label: '待审核记录', value: summary.value.awaitingReview },
  { label: '本月录入', value: summary.value.enteredThisMonth },
])

const statusSummary = computed(() =>
  meta.review!.statuses.map((status) => ({
    status,
    count: summary.value.byStatus[status] ?? 0,
  })),
)

function actionsFor(row: EntryRow): string[] {
  return availableActions(String(row.status), meta.review!)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '林木生长记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  let fieldConclusion: string | undefined
  // 复核后再提交：必须登记现场调查结论；与室内审核冲突时以现场调查结论为准。
  if (String(row.status) === '需复核' && action === '提交审核') {
    const conclusion = window.prompt(
      '请输入现场调查结论（冲突时以现场调查结论为准，历史林分类型仍按当时标准保留）：',
      String(row['调查结论'] ?? ''),
    )
    if (conclusion === null) {
      return
    }
    fieldConclusion = conclusion
  }
  // 带上渲染时的 rev：提交审核与要求复核并发时，只有一个动作能落地。
  const result = applyAction(meta.key, Number(row.id), action, {
    expectedRev: typeof row.rev === 'number' ? row.rev : 1,
    fieldConclusion,
  })
  if (!result.ok) {
    errorMessage.value = result.message
  }
  // 成功或并发冲突都重拉一遍，保证行数据与 rev 是最新的。
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '林木生长列表读取失败'
  }
}

onMounted(reload)
</script>
