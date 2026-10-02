/**
 * 本地开发环境与构建检查的统一入口（doctor）：
 * 1. 示例数据自检：林木生长示例必须满足共用审核规则的派生口径；
 * 2. 旧记录迁移自检：历史林分类型原样保留、旧状态归一、标记重算；
 * 3. 并发自检：提交审核与要求复核同时发生时只允许一个状态落地；
 * 4. 复核待办同步自检：状态变动后汇总口径立即变化。
 *
 * 用 esbuild（Vite 自带依赖）即时编译被测 TS，@ 别名指向 src，不产出临时文件。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '..', 'src')

async function loadTs(relativePath) {
  const result = await build({
    entryPoints: [resolve(srcRoot, ...relativePath.split('/'))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    alias: { '@': srcRoot },
  })
  const code = result.outputFiles[0].text
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  return import(dataUrl)
}

const checks = []

function check(name, fn) {
  checks.push(async () => {
    await fn()
    console.log(`  ✓ ${name}`)
  })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const seedModule = await loadTs('data/seed.ts')
  const audit = await loadTs('domain/audit.ts')
  const migration = await loadTs('data/migration.ts')
  const service = await loadTs('api/local-service.ts')
  const seedRows = seedModule.SEED_ROWS.treegrowth
  const now = new Date(2026, 8, 30) // 2026-09-30，与示例调查日期同月

  check('示例数据：每行 pending/abnormal 与共用审核规则一致', () => {
    for (const row of seedRows) {
      assert(
        row.pending === audit.isPendingStatus(row.status),
        `记录 ${row.id} 的 pending 不符合审核规则`,
      )
      assert(
        row.abnormal === audit.isAbnormalStatus(row.status),
        `记录 ${row.id} 的 abnormal 不符合审核规则`,
      )
    }
  })

  check('示例数据：样地编号去重（6 条重复调查 / 4 个样地）', () => {
    const metrics = audit.auditMetrics(seedRows, now)
    assert(metrics.total === 6, `总量应为 6，实际 ${metrics.total}`)
    assert(metrics.plotCount === 4, `样地数量应为 4，实际 ${metrics.plotCount}`)
    assert(metrics.pendingReview === 2, `待审核应为 2，实际 ${metrics.pendingReview}`)
    assert(metrics.recheckCount === 1, `复核待办应为 1，实际 ${metrics.recheckCount}`)
    assert(metrics.archivedCount === 1, `已归档应为 1，实际 ${metrics.archivedCount}`)
  })

  check('示例数据：本月录入按调查日期统计（2026-09 共 4 条）', () => {
    const metrics = audit.auditMetrics(seedRows, now)
    assert(metrics.monthEntered === 4, `本月录入应为 4，实际 ${metrics.monthEntered}`)
  })

  check('状态机：非法流转被拒绝、合法流转放行、归档为终态', () => {
    assert(audit.canTransition('已录入', '提交审核'), '已录入应可提交审核')
    assert(!audit.canTransition('已录入', '确认记录'), '已录入不应可直接归档')
    assert(!audit.canTransition('已审核', '提交审核'), '已审核不应可重复提交')
    assert(audit.canTransition('已审核', '要求复核'), '已审核应可要求复核')
    assert(audit.canTransition('需复核', '采纳现场结论'), '需复核应可采纳现场结论')
    assert(!audit.canTransition('已归档', '确认记录'), '已归档不可再操作')
  })

  check('旧记录迁移：历史林分类型按当时标准原样保留', () => {
    const legacyStand = '人工杉木纯林（1999年分类）'
    const migrated = migration.migrateTreeRow({
      id: 9,
      status: '已录入',
      pending: true,
      abnormal: false,
      林分类型: legacyStand,
    })
    assert(migrated['林分类型'] === legacyStand, '迁移改写了历史林分类型')
    assert(typeof migrated['迁移时间'] === 'string' && migrated['迁移时间'] !== '', '应补迁移时间')
  })

  check('旧记录迁移：旧状态同义写法归一、未知状态回退已录入', () => {
    assert(migration.migrateTreeRow({ id: 1, status: '复核中' }).status === '需复核', '复核中应归一到需复核')
    assert(migration.migrateTreeRow({ id: 2, status: '已封存' }).status === '已归档', '已封存应归一到已归档')
    assert(migration.migrateTreeRow({ id: 3, status: '不知道啥状态' }).status === '已录入', '未知状态应回退已录入')
    const recheck = migration.migrateTreeRow({ id: 4, status: '复核中' })
    assert(recheck.abnormal === true && recheck.pending === true, '复核记录标记应重算')
  })

  check('旧记录迁移：裸结构升级到当前数据版本', () => {
    const normalized = migration.normalizeData({ treegrowth: [{ id: 1, status: '待审核' }] })
    assert(normalized.version === 1, '裸结构应识别为 v1')
    const { data, migrated } = migration.migrateData(normalized, now)
    assert(data.version === migration.DATA_SCHEMA_VERSION, '应升级到当前版本')
    assert(migrated === 1, '应报告迁移了 1 条')
    assert(data.modules.treegrowth[0].status === '已录入', '待审核应归一到已录入')
  })

  check('存储层端到端：旧版裸数据读取即迁移并写回新版本，历史林分类型保留', async () => {
    // 模拟旧版本：localStorage 里是不带版本号的裸结构，flags 也是旧的错误口径。
    const legacyStand = '马尾松天然林（2003年分类）'
    const legacy = {
      treegrowth: [
        {
          id: 1,
          status: '复核中',
          pending: false,
          abnormal: false,
          记录编号: 'TREE-OLD-1',
          样地编号: 'YD-OLD-1',
          林分类型: legacyStand,
        },
      ],
    }
    const backing = new Map()
    backing.set('forest-fire-patrol:entries', JSON.stringify(legacy))
    globalThis.window = {
      localStorage: {
        getItem: (k) => (backing.has(k) ? backing.get(k) : null),
        setItem: (k, v) => backing.set(k, String(v)),
        removeItem: (k) => backing.delete(k),
      },
      addEventListener: () => {},
    }
    const store = await loadTs('data/local-store.ts?fresh=1')
    const rows = store.listRows('treegrowth').filter((row) => row.样地编号 === 'YD-OLD-1')
    assert(rows.length === 1, '旧记录应仍在树生长模块中')
    assert(rows[0].status === '需复核', '复核中应迁移为需复核')
    assert(rows[0].abnormal === true && rows[0].pending === true, '派生标记应按新规则重算')
    assert(rows[0]['林分类型'] === legacyStand, '历史林分类型必须原样保留')
    assert(typeof rows[0]['迁移时间'] === 'string', '应补迁移时间')
    // 其它模块的示例数据应补齐。
    assert(store.listRows('patrol').length >= 3, '其它模块示例数据应补齐')
    // 写回的应是带版本号的新结构。
    const written = JSON.parse(backing.get('forest-fire-patrol:entries'))
    assert(written.version === store.schemaVersion(), '迁移结果应写回当前版本号')
    assert(written.modules.treegrowth[0]['林分类型'] === legacyStand, '写回数据仍应保留历史林分类型')
    delete globalThis.window
  })

  check('复核待办同步：状态变化后汇总口径立即反映', () => {
    const rows = [
      { id: 1, status: '已审核', '样地编号': 'YD-001' },
      { id: 2, status: '需复核', '样地编号': 'YD-002' },
    ]
    const before = audit.auditMetrics(rows, now)
    assert(before.recheckCount === 1, '初始应有 1 条复核待办')
    // 模拟「采纳现场结论」落地：需复核 -> 已审核，待办清零。
    rows[1] = { ...rows[1], status: '已审核' }
    const after = audit.auditMetrics(rows, now)
    assert(after.recheckCount === 0, '采纳现场结论后复核待办应为 0')
    assert(after.pendingReview === 0 && after.plotCount === 2, '其余口径应保持正确')
  })

  check('并发闸门：提交审核与要求复核只允许一个状态落地', async () => {
    let state = '已录入'
    const worker = async (action) => {
      // 模拟审核动作的落库耗时，制造真正的并发窗口。
      await new Promise((resolveTick) => setTimeout(resolveTick, 5))
      const before = state
      const target = action === '提交审核' ? '已审核' : '需复核'
      state = target
      return { from: before, to: target }
    }
    const [a, b] = await Promise.all([
      audit.runAuditTransition('treegrowth', 1, '提交审核', () => worker('提交审核')),
      audit.runAuditTransition('treegrowth', 1, '要求复核', () => worker('要求复核')),
    ])
    const landed = [a, b].filter((r) => r.ok)
    const blocked = [a, b].filter((r) => !r.ok)
    assert(landed.length === 1, `应有且仅有一个动作落地，实际 ${landed.length}`)
    assert(blocked.length === 1 && blocked[0].conflict, '另一个动作应收到冲突提示')
    assert(state === '已审核', '先取得闸门的提交审核应落地为已审核')
  })

  check('端到端：两个并发动作基于同一状态发起时只落一个（local-service）', async () => {
    // id=1 在示例数据里是「已录入」，两条并发动作都带着点击时所见的状态发起。
    const [r1, r2] = await Promise.all([
      service.runAuditAction('treegrowth', 1, '提交审核', '已录入'),
      service.runAuditAction('treegrowth', 1, '要求复核', '已录入'),
    ])
    const oks = [r1, r2].filter((r) => r.ok)
    const fails = [r1, r2].filter((r) => !r.ok)
    assert(oks.length === 1, `并发时应只成功一个，实际成功 ${oks.length}`)
    assert(fails.length === 1, '另一个应失败')
    const after = service.listEntries('treegrowth').items.find((row) => row.id === 1)
    assert(after.status === '已审核', `落地状态应为已审核，实际 ${after.status}`)
    // 再发一次重复提交应被状态机拒绝（已审核不能再提交审核）。
    const dup = await service.runAuditAction('treegrowth', 1, '提交审核', '已审核')
    assert(!dup.ok, '已审核状态不应允许重复提交审核')
    service.resetModule('treegrowth')
  })

  for (const checkFn of checks) {
    await checkFn()
  }
  console.log(`\n全部 ${checks.length} 项检查通过（示例数据 / 旧记录迁移 / 并发互斥 / 复核待办同步）`)
}

main().catch((error) => {
  console.error('\n检查失败：')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
