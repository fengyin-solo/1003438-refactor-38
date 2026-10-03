/**
 * 本地数据迁移管线：localStorage 里的历史数据按 schema 版本顺序升级。
 * 示例种子数据同样走一遍 normalize，保证「播种 + 迁移 + 运行时」口径一致。
 */

import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'
import { isReviewPending } from '@/domain/review'

export const STORAGE_SCHEMA_VERSION = 2

export type VersionedStore = {
  version: number
  modules: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * v1 -> v2：林木生长模块接入共用审核规则。
 * 注意：历史林分类型按当时标准原样保留，不做任何新旧标准映射或改写；
 * 样地编号也原样保留，样地数量的去重口径交给共用规则统算。
 */
function migrateV1ToV2(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next = clone(data)
  const rows = next.treegrowth
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!('调查日期' in row)) {
        row['调查日期'] = ''
      }
      if (!('调查结论' in row)) {
        row['调查结论'] = ''
      }
      // 待办标记按共用状态机重新计算：已归档不再算待办，需复核重新进入待办。
      row.pending = String(row.status) !== '已归档'
      // 旧的演示异常位随新规则清掉：退回复核是正常流程，不算异常。
      row.abnormal = false
      row.rev = typeof row.rev === 'number' ? row.rev : 1
    }
  }
  return next
}

const MIGRATIONS: ((data: Record<string, EntryRow[]>) => Record<string, EntryRow[]>)[] = [
  // 数组下标 0 对应 v1 -> v2。
  migrateV1ToV2,
]

/** 把任意历史版本的数据顺序迁移到当前版本。 */
export function migrate(
  data: Record<string, EntryRow[]>,
  fromVersion: number,
): Record<string, EntryRow[]> {
  let current = data
  for (let version = fromVersion; version < STORAGE_SCHEMA_VERSION; version += 1) {
    const migration = MIGRATIONS[version - 1]
    if (migration) {
      current = migration(current)
    }
  }
  return current
}

/**
 * 规范化任意来源的数据：补 rev、按模块重算 pending。
 * 种子首次播种和老用户升级都经过这里，避免示例数据与迁移数据两套口径。
 */
export function normalize(data: Record<string, EntryRow[]>): VersionedStore {
  const modules: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) {
      continue
    }
    const meta = MODULE_BY_KEY.get(key)
    modules[key] = rows.map((row) => {
      const normalized: EntryRow = { ...row, rev: typeof row.rev === 'number' ? row.rev : 1 }
      if (meta?.review) {
        // 审核流模块的待办只由共用规则决定（非终态即待办），不信任来源里的旧值。
        normalized.pending = isReviewPending(row)
      }
      return normalized
    })
  }
  return { version: STORAGE_SCHEMA_VERSION, modules }
}

/** 播种当前版本的示例数据（同样经过规范化）。 */
export function seedStore(): VersionedStore {
  return normalize(clone(SEED_ROWS))
}

/** localStorage 可能是旧版（裸 modules）或带版本号的结构，统一解析升级。 */
export function upgradeParsed(parsed: unknown): VersionedStore {
  if (parsed && typeof parsed === 'object' && 'modules' in parsed) {
    const versioned = parsed as Partial<VersionedStore>
    const version = typeof versioned.version === 'number' ? versioned.version : 1
    const modules = (versioned.modules ?? {}) as Record<string, EntryRow[]>
    return normalize(migrate(modules, version))
  }
  // v1 结构：顶层直接是 Record<模块, 行[]>。
  return normalize(migrate(parsed as Record<string, EntryRow[]>, 1))
}
