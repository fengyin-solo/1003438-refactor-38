import { SEED_ROWS } from './seed'
import {
  DATA_SCHEMA_VERSION,
  mergeSeedRows,
  migrateData,
  normalizeData,
} from './migration'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'

type ChangeListener = (key: string) => void

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedModules(): Record<string, EntryRow[]> {
  return clone(SEED_ROWS)
}

function buildInitial(): { modules: Record<string, EntryRow[]>; version: number } {
  return { modules: seedModules(), version: DATA_SCHEMA_VERSION }
}

/**
 * 读出本地数据并归一到当前版本：
 * 1. 旧版裸结构/低版本结构统一跑迁移；
 * 2. 示例数据新增的行补进来，浏览器里已有的行（含历史林分类型）原样保留；
 * 3. 迁移后的结果立即写回，下次打开直接命中新版本。
 */
function readStorage(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return buildInitial().modules
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const initial = buildInitial()
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: initial.version, modules: initial.modules }),
    )
    return initial.modules
  }
  let normalized: ReturnType<typeof normalizeData>
  try {
    normalized = normalizeData(JSON.parse(raw))
  } catch {
    const initial = buildInitial()
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: initial.version, modules: initial.modules }),
    )
    return initial.modules
  }
  const { data, migrated } = migrateData(normalized)
  const seed = seedModules()
  const modules: Record<string, EntryRow[]> = { ...seed }
  for (const key of Object.keys(data.modules)) {
    modules[key] = mergeSeedRows(data.modules[key], seed[key] ?? [])
  }
  if (migrated > 0 || normalized.version < DATA_SCHEMA_VERSION) {
    persist({ version: DATA_SCHEMA_VERSION, modules })
  }
  return modules
}

function persist(payload: { version: number; modules: Record<string, EntryRow[]> }): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }
}

let cache: Record<string, EntryRow[]> | null = null
const listeners = new Set<ChangeListener>()
let crossTabBound = false

function ensureCrossTabSync(): void {
  if (crossTabBound || typeof window === 'undefined' || !window.addEventListener) {
    return
  }
  crossTabBound = true
  // 另一个标签页落了审核/复核动作，本标签页的待办也跟着更新。
  // 跨标签页拿不到精确的变更模块，按全量变更通知，订阅方自行重取。
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) {
      return
    }
    cache = null
    for (const listener of listeners) {
      listener('*')
    }
  })
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist({ version: DATA_SCHEMA_VERSION, modules: next })
  for (const listener of listeners) {
    listener(key)
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 订阅模块数据变化：新规则驱动其余入口的复核待办同步更新。 */
export function subscribeRows(listener: ChangeListener): () => void {
  ensureCrossTabSync()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function schemaVersion(): number {
  return DATA_SCHEMA_VERSION
}
