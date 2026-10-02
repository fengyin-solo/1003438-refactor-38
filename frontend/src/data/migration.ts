import {
  AUDIT_ARCHIVED,
  AUDIT_ENTERED,
  AUDIT_RECHECK,
  AUDIT_REVIEWED,
  AUDIT_STATUSES,
  isAbnormalStatus,
  isPendingStatus,
} from '@/domain/audit'
import type { EntryRow } from '@/data/types'

/**
 * 旧记录迁移：把早期版本散落在 localStorage 里的林木生长记录搬到共用审核规则上。
 * 原则：
 * - 冲突时以现场调查结论为准（状态以调查现场的处置为准，不认旧的派生标记）；
 * - 历史林分类型按当时标准保留，迁移永不改写「林分类型」字段，只补缺失结构。
 */

export const DATA_SCHEMA_VERSION = 2
export const TREE_KEY = 'treegrowth'
const LEGACY_VERSION = 1
const MIGRATED_AT_FIELD = '迁移时间'
const SURVEY_DATE_FIELD = '调查日期'
const STAND_TYPE_FIELD = '林分类型'

/** 旧状态 → 共用审核状态；认不出的一律回到「已录入」重新走流程。 */
const LEGACY_STATUS_MAP: Record<string, string> = {
  已录入: AUDIT_ENTERED,
  已审核: AUDIT_REVIEWED,
  需复核: AUDIT_RECHECK,
  已归档: AUDIT_ARCHIVED,
  // 旧版本可能出现的同义写法，按现场调查结论归一。
  待审核: AUDIT_ENTERED,
  复核中: AUDIT_RECHECK,
  已封存: AUDIT_ARCHIVED,
}

export type VersionedData = {
  version: number
  modules: Record<string, EntryRow[]>
}

export function isVersionedData(value: unknown): value is VersionedData {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as VersionedData).version === 'number' &&
    typeof (value as VersionedData).modules === 'object' &&
    (value as VersionedData).modules !== null
  )
}

/** 兼容读取：旧版是裸的 { 模块: 行[] }，新版带版本号包了一层。 */
export function normalizeData(raw: unknown): VersionedData {
  if (isVersionedData(raw)) {
    return { version: raw.version, modules: raw.modules }
  }
  if (typeof raw === 'object' && raw !== null) {
    return { version: LEGACY_VERSION, modules: raw as Record<string, EntryRow[]> }
  }
  return { version: 0, modules: {} }
}

/**
 * 迁移一条旧林木生长记录。林分类型原样保留（历史林分类型按当时标准），
 * 只统一状态与派生标记；缺调查日期的不臆造，本月录入统计自然不计入。
 */
export function migrateTreeRow(row: EntryRow, now: Date = new Date()): EntryRow {
  const legacyStatus = String(row.status ?? '')
  const status = AUDIT_STATUSES.includes(legacyStatus as (typeof AUDIT_STATUSES)[number])
    ? legacyStatus
    : LEGACY_STATUS_MAP[legacyStatus] ?? AUDIT_ENTERED
  const migratedAt =
    String(row[MIGRATED_AT_FIELD] ?? '') || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return {
    ...row,
    status,
    // 林分类型随展开透传、绝不覆盖；显式补一份默认值只在字段缺失时生效。
    [STAND_TYPE_FIELD]: row[STAND_TYPE_FIELD] ?? '历史林分（按当时标准保留）',
    [SURVEY_DATE_FIELD]: row[SURVEY_DATE_FIELD] ?? '',
    [MIGRATED_AT_FIELD]: migratedAt,
    pending: isPendingStatus(status),
    abnormal: isAbnormalStatus(status),
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 把任意历史版本的数据搬到当前版本。
 * 只对林木生长模块跑审核规则迁移，其它模块原样保留。
 */
export function migrateData(
  data: VersionedData,
  now: Date = new Date(),
): { data: VersionedData; migrated: number } {
  if (data.version >= DATA_SCHEMA_VERSION) {
    return { data, migrated: 0 }
  }
  const legacyRows = data.modules[TREE_KEY] ?? []
  let migrated = 0
  const modules: Record<string, EntryRow[]> = { ...data.modules }
  modules[TREE_KEY] = legacyRows.map((row) => {
    if (!AUDIT_STATUSES.includes(String(row.status) as (typeof AUDIT_STATUSES)[number])) {
      migrated += 1
    } else if (
      typeof row.pending !== 'boolean' ||
      typeof row.abnormal !== 'boolean' ||
      row[MIGRATED_AT_FIELD] === undefined
    ) {
      // 状态合法但派生标记/结构是旧的，也按规则重算一次。
      migrated += 1
    }
    return migrateTreeRow(row, now)
  })
  return { data: { version: DATA_SCHEMA_VERSION, modules }, migrated }
}

/** 用示例数据补齐缺失行时，同样不能动浏览器里已有的林分类型（现场结论优先）。 */
export function mergeSeedRows(
  stored: EntryRow[] | undefined,
  seed: EntryRow[],
): EntryRow[] {
  if (!stored || stored.length === 0) {
    return seed
  }
  const byId = new Map(stored.map((row) => [Number(row.id), row]))
  const merged = [...stored]
  for (const seedRow of seed) {
    if (!byId.has(Number(seedRow.id))) {
      merged.push(seedRow)
    }
  }
  return merged
}
