import type { ActionResult, EntryRow, ModuleMeta } from '@/data/types'

/**
 * 共用审核规则：林木生长记录的「录入 → 审核 → 复核 → 归档」全流程只认这一份。
 * 页面、本地服务、看板统计与旧数据迁移都从这里取规则，不再各自写一遍。
 */

export const AUDIT_ENTERED = '已录入'
export const AUDIT_REVIEWED = '已审核'
export const AUDIT_RECHECK = '需复核'
export const AUDIT_ARCHIVED = '已归档'

export const AUDIT_STATUSES = [
  AUDIT_ENTERED,
  AUDIT_REVIEWED,
  AUDIT_RECHECK,
  AUDIT_ARCHIVED,
] as const

/** 审核流动作（注意：「采纳现场结论」冲突时以现场调查结论为准）。 */
export const AUDIT_ACTIONS = ['提交审核', '要求复核', '采纳现场结论', '确认记录'] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** 动作落到哪个状态。 */
export const AUDIT_ACTION_TARGET: Record<AuditAction, string> = {
  提交审核: AUDIT_REVIEWED,
  要求复核: AUDIT_RECHECK,
  采纳现场结论: AUDIT_REVIEWED,
  确认记录: AUDIT_ARCHIVED,
}

/**
 * 状态机前置条件：只有列出的状态允许执行该动作。
 * 已归档是终态，不出现在任何前置状态里，归档记录不可再改。
 */
const AUDIT_TRANSITIONS: Record<AuditAction, string[]> = {
  提交审核: [AUDIT_ENTERED],
  要求复核: [AUDIT_REVIEWED],
  采纳现场结论: [AUDIT_RECHECK],
  确认记录: [AUDIT_REVIEWED],
}

export function isAuditStatus(status: string): boolean {
  return (AUDIT_STATUSES as readonly string[]).includes(status)
}

export function canTransition(status: string, action: string): boolean {
  const allowed = AUDIT_TRANSITIONS[action as AuditAction]
  return Array.isArray(allowed) && allowed.includes(status)
}

/** 已归档不再待办；复核中的记录在看板上按异常待办提示。 */
export function isPendingStatus(status: string): boolean {
  return status !== AUDIT_ARCHIVED
}

export function isAbnormalStatus(status: string): boolean {
  return status === AUDIT_RECHECK
}

/** 规则驱动入口：页面只渲染当前状态真正可执行的动作。 */
export function availableAuditActions(row: Pick<EntryRow, 'status'>): string[] {
  const status = String(row.status)
  return AUDIT_ACTIONS.filter((action) => canTransition(status, action))
}

export function auditTargetOf(action: string): string | undefined {
  return AUDIT_ACTION_TARGET[action as AuditAction]
}

/** 拒绝原因统一在这里生成，所有入口拿到的提示一致。 */
export function rejectAudit(
  meta: ModuleMeta,
  status: string,
  action: string,
): ActionResult {
  if (!auditTargetOf(action)) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  if (status === AUDIT_ARCHIVED) {
    return { ok: false, message: `${meta.entity}已归档封存，不能再执行「${action}」` }
  }
  return {
    ok: false,
    message: `${meta.entity}当前为「${status}」，不允许执行「${action}」`,
  }
}

export type AuditMetrics = {
  total: number
  /** 样地数量：按样地编号去重，同一样地多次调查只算一个。 */
  plotCount: number
  /** 待审核：已录入、还没送审的记录。 */
  pendingReview: number
  /** 复核待办：需复核的记录，驱动其余入口同步。 */
  recheckCount: number
  archivedCount: number
  /** 本月录入：按调查日期归属当月。 */
  monthEntered: number
  /** 各状态计数，页面状态图例直接取这份，不再自行 filter。 */
  statusCounts: Record<string, number>
}

const PLOT_FIELD = '样地编号'
const SURVEY_DATE_FIELD = '调查日期'

export function sameMonth(value: string, now: Date = new Date()): boolean {
  if (!value) {
    return false
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return false
  }
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
}

/**
 * 唯一一份汇总口径：样地编号去重、待审核/复核待办/归档/本月录入都从这里出，
 * 页面卡片、状态图例、看板概览不许再各 filter 一遍。
 */
/** 状态计数（可作用于筛选后的行）：页面状态图例直接取这份，不再自行 filter。 */
export function auditStatusCounts(rows: Pick<EntryRow, 'status'>[]): Record<string, number> {
  const counts = AUDIT_STATUSES.reduce<Record<string, number>>((acc, status) => {
    acc[status] = 0
    return acc
  }, {})
  for (const row of rows) {
    const status = String(row.status)
    if (status in counts) {
      counts[status] += 1
    }
  }
  return counts
}

export function auditMetrics(rows: EntryRow[], now: Date = new Date()): AuditMetrics {
  const plots = new Set<string>()
  const statusCounts = auditStatusCounts(rows)
  let monthEntered = 0
  for (const row of rows) {
    const plot = String(row[PLOT_FIELD] ?? '').trim()
    if (plot) {
      plots.add(plot)
    }
    if (sameMonth(String(row[SURVEY_DATE_FIELD] ?? ''), now)) {
      monthEntered += 1
    }
  }
  return {
    total: rows.length,
    plotCount: plots.size,
    pendingReview: statusCounts[AUDIT_ENTERED],
    recheckCount: statusCounts[AUDIT_RECHECK],
    archivedCount: statusCounts[AUDIT_ARCHIVED],
    monthEntered,
    statusCounts,
  }
}

/**
 * 并发闸门：同一条记录同时只允许一个审核动作落地。
 * 「提交审核」与「要求复核」并发时，后到的请求在这里被挡住，
 * worker 内部还会基于最新状态二次校验，保证只落一个状态。
 */
const inflight = new Set<string>()

export async function runAuditTransition<T>(
  key: string,
  id: number,
  action: string,
  worker: () => T | Promise<T>,
): Promise<{ ok: boolean; result?: T; conflict?: ActionResult }> {
  const lockKey = `${key}:${id}`
  if (inflight.has(lockKey)) {
    return {
      ok: false,
      conflict: {
        ok: false,
        message: `该记录正在处理另一个审核动作，本次「${action}」未生效`,
      },
    }
  }
  inflight.add(lockKey)
  try {
    // 让出一个事件循环窗口，把并发的另一个请求暴露在闸门之外。
    await Promise.resolve()
    return { ok: true, result: await worker() }
  } finally {
    inflight.delete(lockKey)
  }
}
