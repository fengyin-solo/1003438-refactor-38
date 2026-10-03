import { seedStore, STORAGE_SCHEMA_VERSION, upgradeParsed } from './migrations'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'forest-fire-patrol:entries'

type ChangeListener = (key: string) => void

const listeners = new Set<ChangeListener>()

/** 订阅本地数据变更；动作流转、重置后都会触发，复核待办据此同步到其余入口。 */
export function subscribeStore(listener: ChangeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitChange(key: string): void {
  for (const listener of listeners) {
    listener(key)
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = seedStore()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback.modules
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback.modules
  }
  try {
    const parsed = JSON.parse(raw)
    const storedVersion =
      parsed && typeof parsed === 'object' && 'modules' in parsed &&
      typeof parsed.version === 'number'
        ? parsed.version
        : 1
    const upgraded = upgradeParsed(parsed)
    if (storedVersion !== STORAGE_SCHEMA_VERSION) {
      // 老版本（裸结构或低版本号）迁移后写回当前结构，下次直接命中。
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded))
    }
    return upgraded.modules
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback.modules
  }
}

let cache: Record<string, EntryRow[]> | null = null

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
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_SCHEMA_VERSION, modules: next }),
    )
  }
  emitChange(key)
}

export function resetRows(key: string): EntryRow[] {
  const rows = seedStore().modules[key] ?? []
  saveRows(key, rows)
  return rows
}

/** 测试/校验脚本用：直接灌入指定版本的数据并走一遍迁移。 */
export function hydrate(store: { version: number; modules: Record<string, EntryRow[]> }): void {
  const upgraded = upgradeParsed(store)
  cache = upgraded.modules
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded))
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}

export function storageSchemaVersion(): number {
  return STORAGE_SCHEMA_VERSION
}
