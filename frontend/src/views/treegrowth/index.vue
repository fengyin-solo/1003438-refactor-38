<template>
  <section class="page" data-module="treegrowth">
    <header class="page-head">
      <div>
        <h2>林木生长管理</h2>
        <p class="page-desc">维护林木生长记录，围绕记录编号、样地编号、林分类型、平均胸径做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记林木生长记录</button>
        <button class="btn" type="button" @click="exportRows">导出林木生长清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p v-if="summary.recheckCount > 0" class="recheck-banner">
      现有 {{ summary.recheckCount }} 条记录等待复核，冲突以现场调查结论为准，复核通过后执行「采纳现场结论」。
    </p>

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
            <button
              v-for="action in actionsForRow(meta, row)"
              :key="action"
              class="link"
              :disabled="busyId === Number(row.id)"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionsForRow(meta, row).length" class="muted">已归档封存</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无林木生长数据，可先登记林木生长记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条林木生长记录 · {{ summary.plotCount }} 个样地（按样地编号去重）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  actionsForRow,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAuditAction as applyAction,
  treegrowthSummary,
} from '@/api/local-service'
import { subscribeRows } from '@/data/local-store'
import { AUDIT_STATUSES, auditStatusCounts, type AuditMetrics } from '@/domain/audit'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('treegrowth')
// 列、筛选项与模块元数据同源，不再在页面里各写一份。
const columns = meta.fields
const filterFields = meta.fields.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const busyId = ref<number | null>(null)
const filters = ref<Record<string, string>>({})

// 全部汇总数量只认共用规则这一份：卡片、图例、页脚一起消费。
const summary = ref<AuditMetrics>(treegrowthSummary())

const stats = computed(() => [
  { label: '样地数量', value: summary.value.plotCount },
  { label: '待审核记录', value: summary.value.pendingReview },
  { label: '复核待办', value: summary.value.recheckCount },
  { label: '已归档', value: summary.value.archivedCount },
  { label: '本月录入', value: summary.value.monthEntered },
])

const statusSummary = computed(() => {
  // 图例同样走共用规则，只是作用域为筛选后的行。
  const counts = auditStatusCounts(rows.value)
  return AUDIT_STATUSES.map((status) => ({ status, count: counts[status] }))
})

// 数据在任何入口被改动（含其它标签页），复核待办与统计同步更新。
const unsubscribe = subscribeRows(() => {
  summary.value = treegrowthSummary()
})
onUnmounted(unsubscribe)

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

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const id = Number(row.id)
  busyId.value = id
  try {
    // expectedStatus 是点击时该行展示的状态，落库前比对最新状态：
    // 提交审核与要求复核并发时，后到的一方因状态已被改写而被拒绝，只落一个状态。
    const result = await applyAction(meta.key, id, action, String(row.status))
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } finally {
    busyId.value = null
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    summary.value = treegrowthSummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '林木生长列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.recheck-banner {
  margin: 8px 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: #fff4e5;
  color: #9a5b00;
}

.muted {
  color: #999;
}

.link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
