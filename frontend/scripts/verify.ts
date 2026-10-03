/**
 * 校验入口（供 esbuild 打包后在 Node 运行）：
 * 覆盖旧记录迁移、共用审核规则、提交审核/要求复核并发 CAS、复核待办同步口径。
 */
import assert from 'node:assert/strict'

import { hydrate } from '../src/data/local-store'
import { STORAGE_SCHEMA_VERSION } from '../src/data/migrations'
import { listEntries, runAction, reviewSummary, loadOverview } from '../src/api/local-service'
import { FIELD_CONCLUSION_FIELD, REVIEW_STATUS, currentMonth } from '../src/domain/review'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

// 1) 旧记录迁移：v1 结构（裸 modules、无 rev、无调查日期/结论、需复核被错标为非待办）
const legacyTreegrowth = [
  {
    id: 1,
    status: '已录入',
    pending: true,
    abnormal: false,
    记录编号: 'TREE-0001',
    样地编号: 'YD-OLD-01',
    // 历史林分类型：按当时标准保留，迁移不得改写
    林分类型: '老分类-天然次生林',
  },
  {
    id: 2,
    status: '已审核',
    pending: true,
    abnormal: true,
    记录编号: 'TREE-0002',
    样地编号: 'YD-OLD-02',
    林分类型: '老分类-人工针叶纯林',
  },
  {
    id: 3,
    status: '需复核',
    pending: false, // 旧口径错误：需复核其实仍是待办
    abnormal: false,
    记录编号: 'TREE-0003',
    样地编号: 'YD-OLD-02', // 与 id=2 同样地，去重后样地数应为 2
    林分类型: '老分类-针阔混交林',
  },
  {
    id: 4,
    status: '已归档',
    pending: true, // 旧口径错误：归档不该算待办
    abnormal: false,
    记录编号: 'TREE-0004',
    样地编号: 'YD-OLD-03',
    林分类型: '老分类-常绿阔叶林',
  },
]

hydrate({ version: 1, modules: { treegrowth: legacyTreegrowth as never } })

let rows = listEntries('treegrowth').items
check('迁移后到达当前 schema 版本', () => {
  assert.equal(STORAGE_SCHEMA_VERSION, 2)
})
check('历史林分类型按当时标准原样保留', () => {
  assert.equal(rows[0]['林分类型'], '老分类-天然次生林')
  assert.equal(rows[3]['林分类型'], '老分类-常绿阔叶林')
})
check('迁移补齐调查日期/调查结论/rev', () => {
  for (const row of rows) {
    assert.equal(row['调查日期'], '')
    assert.equal(row['调查结论'], '')
    assert.equal(row.rev, 1)
  }
})
check('迁移后待办口径由共用规则重算（需复核算待办、已归档不算）', () => {
  assert.equal(rows[0].pending, true)
  assert.equal(rows[1].pending, true)
  assert.equal(rows[2].pending, true)
  assert.equal(rows[3].pending, false)
  assert.equal(rows[1].abnormal, false)
})
check('样地数量按样地编号去重（YD-OLD-02 两条只算一个）', () => {
  assert.equal(reviewSummary('treegrowth', currentMonth()).plots, 3)
})
check('迁移后复核待办进入看板汇总', () => {
  const overview = loadOverview()
  const todo = overview.reviewTodos.find((item) => item.key === 'treegrowth')
  assert.ok(todo)
  assert.equal(todo!.awaitingReview, 1)
  assert.equal(todo!.awaitingRecheck, 1)
})

// 2) 状态机：已录入只能提交审核；已审核可归档或要求复核；归档终态无动作
check('已录入不能直接确认记录（跳过审核）', () => {
  const result = runAction('treegrowth', 1, '确认记录')
  assert.equal(result.ok, false)
})
check('提交审核：已录入 -> 已审核，rev +1', () => {
  const result = runAction('treegrowth', 1, '提交审核', { expectedRev: 1 })
  assert.equal(result.ok, true)
  rows = listEntries('treegrowth').items
  assert.equal(rows[0].status, REVIEW_STATUS.reviewed)
  assert.equal(rows[0].rev, 2)
})
check('归档终态不允许任何动作', () => {
  const result = runAction('treegrowth', 4, '要求复核', { expectedRev: 1 })
  assert.equal(result.ok, false)
  assert.match(result.message, /已归档/)
})

// 3) 提交审核与要求复核并发：同一行 rev=1（已审核），只有先落地的一个动作生效
hydrate({
  version: STORAGE_SCHEMA_VERSION,
  modules: {
    treegrowth: [
      {
        id: 10,
        status: '已审核',
        pending: true,
        abnormal: false,
        rev: 1,
        记录编号: 'TREE-RACE-01',
        样地编号: 'YD-RACE-01',
        林分类型: '针叶林',
      },
    ],
  },
})

// 两个操作者同时拿到页面（同一份 rev=1），各自发一个互斥动作。
const confirmFirst = runAction('treegrowth', 10, '确认记录', { expectedRev: 1 })
const recheckConcurrent = runAction('treegrowth', 10, '要求复核', { expectedRev: 1 })

check('并发时只有一个状态落地（先到的归档成功）', () => {
  assert.equal(confirmFirst.ok, true)
  assert.equal(recheckConcurrent.ok, false)
  assert.equal(recheckConcurrent.conflict, true)
  const row = listEntries('treegrowth').items[0]
  assert.equal(row.status, REVIEW_STATUS.archived)
  assert.equal(row.rev, 2)
})

// 反过来：要求复核先到，提交审核（归档）必须被拒。
hydrate({
  version: STORAGE_SCHEMA_VERSION,
  modules: {
    treegrowth: [
      {
        id: 11,
        status: '已审核',
        pending: true,
        abnormal: false,
        rev: 1,
        记录编号: 'TREE-RACE-02',
        样地编号: 'YD-RACE-02',
        林分类型: '针叶林',
      },
    ],
  },
})
const recheckFirst = runAction('treegrowth', 11, '要求复核', { expectedRev: 1 })
const confirmConcurrent = runAction('treegrowth', 11, '确认记录', { expectedRev: 1 })
check('并发顺序反过来同样互斥（复核先落地，归档被拒）', () => {
  assert.equal(recheckFirst.ok, true)
  assert.equal(confirmConcurrent.ok, false)
  assert.equal(confirmConcurrent.conflict, true)
  const row = listEntries('treegrowth').items[0]
  assert.equal(row.status, REVIEW_STATUS.recheck)
})

// 4) 复核后再提交必须带现场调查结论；冲突时以现场调查结论为准
check('需复核无现场结论不能提交审核', () => {
  const result = runAction('treegrowth', 11, '提交审核', { expectedRev: 2 })
  assert.equal(result.ok, false)
  assert.match(result.message, /现场调查结论/)
})
check('登记现场调查结论后可提交，结论随状态一并落库', () => {
  const result = runAction('treegrowth', 11, '提交审核', {
    expectedRev: 2,
    fieldConclusion: '现场实测郁闭度 0.71，与室内判读有出入，以现场调查结论为准',
  })
  assert.equal(result.ok, true)
  const row = listEntries('treegrowth').items[0]
  assert.equal(row.status, REVIEW_STATUS.reviewed)
  assert.match(String(row[FIELD_CONCLUSION_FIELD]), /以现场调查结论为准/)
  assert.equal(row.rev, 3)
})

// 5) 待办随状态流转同步更新（其余入口的口径）
// 用「需复核」行：提交审核后 awaitingRecheck -1，待审核不增加（已审核不再是待审核）。
hydrate({
  version: STORAGE_SCHEMA_VERSION,
  modules: {
    treegrowth: [
      {
        id: 20,
        status: '需复核',
        pending: true,
        abnormal: false,
        rev: 4,
        记录编号: 'TREE-SYNC-01',
        样地编号: 'YD-SYNC-01',
        林分类型: '针阔混交林',
      },
    ],
  },
})
check('动作落地后看板与汇总待办同步更新', () => {
  const todoBefore = loadOverview().reviewTodos.find((item) => item.key === 'treegrowth')
  const summaryBefore = reviewSummary('treegrowth', currentMonth())
  assert.equal(todoBefore!.awaitingRecheck, 1)
  assert.equal(summaryBefore.pending, 1)

  const result = runAction('treegrowth', 20, '提交审核', {
    expectedRev: 4,
    fieldConclusion: '现场复核胸径一致，以现场调查结论为准',
  })
  assert.equal(result.ok, true)

  const todoAfter = loadOverview().reviewTodos.find((item) => item.key === 'treegrowth')
  const summaryAfter = reviewSummary('treegrowth', currentMonth())
  assert.equal(todoAfter!.awaitingRecheck, 0)
  // 已审核仍在流程中（待归档），pending 总数不变但复核待办清零，与其余入口展示一致。
  assert.equal(summaryAfter.pending, summaryBefore.pending)

  runAction('treegrowth', 20, '确认记录', { expectedRev: 5 })
  const todoArchived = loadOverview().reviewTodos.find((item) => item.key === 'treegrowth')
  assert.equal(todoArchived!.awaitingReview, 0)
  assert.equal(todoArchived!.awaitingRecheck, 0)
  assert.equal(reviewSummary('treegrowth', currentMonth()).pending, 0)
})

console.log(`\n全部通过：${passed} 项检查`)
