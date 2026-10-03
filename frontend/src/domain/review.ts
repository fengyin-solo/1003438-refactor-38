/**
 * 共用审核规则：林木生长记录的审核、复核、归档状态机与口径都收敛在这里，
 * 页面、看板、侧栏、迁移脚本和校验脚本只消费这份规则，不再各写一遍。
 */

import type { EntryRow, ReviewMeta } from '@/data/types'

export const REVIEW_STATUS = {
  entered: '已录入',
  reviewed: '已审核',
  recheck: '需复核',
  archived: '已归档',
} as const

/** 终态：归档后不允许再走任何动作。 */
export const REVIEW_TERMINAL_STATUSES: ReadonlySet<string> = new Set([REVIEW_STATUS.archived])

// 动作名与模块元数据里登记的动作保持一致。
export const REVIEW_ACTION = {
  submit: '提交审核',
  recheck: '要求复核',
  confirm: '确认记录',
} as const

/** 要求复核 / 复核通过时必须落到现场调查结论，冲突时以现场调查结论为准。 */
export const FIELD_CONCLUSION_FIELD = '调查结论'

/** 迁移时补齐的调查日期字段，本月录入指标按它统计。 */
export const SURVEY_DATE_FIELD = '调查日期'

/**
 * 状态流转表：from -> action -> to。
 * 已录入/需复核 --提交审核--> 已审核（复核提交需先登记现场调查结论）
 * 已审核 --确认记录--> 已归档
 * 已审核 --要求复核--> 需复核
 * 已归档为终态，不允许任何流转。
 */
const TRANSITIONS: Record<string, Record<string, string>> = {
  [REVIEW_STATUS.entered]: {
    [REVIEW_ACTION.submit]: REVIEW_STATUS.reviewed,
  },
  [REVIEW_STATUS.reviewed]: {
    [REVIEW_ACTION.confirm]: REVIEW_STATUS.archived,
    [REVIEW_ACTION.recheck]: REVIEW_STATUS.recheck,
  },
  [REVIEW_STATUS.recheck]: {
    [REVIEW_ACTION.submit]: REVIEW_STATUS.reviewed,
  },
}

export type ReviewDecision =
  | { allowed: true; target: string; requiresFieldConclusion: boolean }
  | { allowed: false; reason: string }

/**
 * 判断某条记录在当前状态下能否执行指定动作（只看状态机）。
 * requiresFieldConclusion=true 时，调用方（服务层）必须额外拿到本次登记的现场调查结论。
 */
export function reviewDecision(current: string, action: string): ReviewDecision {
  if (REVIEW_TERMINAL_STATUSES.has(current)) {
    return { allowed: false, reason: `记录已${REVIEW_STATUS.archived}，不能再执行「${action}」` }
  }
  const target = TRANSITIONS[current]?.[action]
  if (!target) {
    return { allowed: false, reason: `「${current}」状态不允许执行「${action}」` }
  }
  return {
    allowed: true,
    target,
    requiresFieldConclusion:
      current === REVIEW_STATUS.recheck && action === REVIEW_ACTION.submit,
  }
}

/** 当前状态下可执行的动作，页面只渲染这里返回的按钮，避免误操作入口。 */
export function availableActions(current: string, review: ReviewMeta): string[] {
  return review.actions.filter((action) => reviewDecision(current, action).allowed)
}

/** 非终态都算待办；口径与看板、侧栏完全一致。 */
export function isReviewPending(row: EntryRow): boolean {
  return !REVIEW_TERMINAL_STATUSES.has(String(row.status))
}

/** 待审核：已录入，等待审核员处理。 */
export function countAwaitingReview(rows: EntryRow[]): number {
  return rows.filter((row) => String(row.status) === REVIEW_STATUS.entered).length
}

/** 待复核：审核后被打回复核，是其余入口待办要同步的数字。 */
export function countAwaitingRecheck(rows: EntryRow[]): number {
  return rows.filter((row) => String(row.status) === REVIEW_STATUS.recheck).length
}

/** 样地数量：按样地编号去重，页面指标和任何汇总都用这一个口径。 */
export function countDistinctPlots(rows: EntryRow[], plotField: string): number {
  return new Set(rows.map((row) => String(row[plotField] ?? '').trim()).filter(Boolean)).size
}

/** 本月录入：以调查日期所在年月为准，没有合法日期的旧记录不计入。 */
export function countEnteredThisMonth(rows: EntryRow[], month: string): number {
  return rows.filter((row) => String(row[SURVEY_DATE_FIELD] ?? '').startsWith(month)).length
}

export type ReviewSummary = {
  total: number
  plots: number
  awaitingReview: number
  awaitingRecheck: number
  enteredThisMonth: number
  pending: number
  byStatus: Record<string, number>
}

/** 林木生长页面指标 + 看板待办共用的一次汇总，样地编号与数量只算这一遍。 */
export function summarizeReview(
  rows: EntryRow[],
  review: ReviewMeta,
  month: string,
): ReviewSummary {
  const byStatus: Record<string, number> = {}
  for (const status of review.statuses) {
    byStatus[status] = 0
  }
  for (const row of rows) {
    const status = String(row.status)
    byStatus[status] = (byStatus[status] ?? 0) + 1
  }
  return {
    total: rows.length,
    plots: countDistinctPlots(rows, review.plotField),
    awaitingReview: countAwaitingReview(rows),
    awaitingRecheck: countAwaitingRecheck(rows),
    enteredThisMonth: countEnteredThisMonth(rows, month),
    pending: rows.filter(isReviewPending).length,
    byStatus,
  }
}

/** 当前年月，格式 YYYY-MM（本地时区，与调查日期字段保持一致）。 */
export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
