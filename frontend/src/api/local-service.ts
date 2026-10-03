import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  FIELD_CONCLUSION_FIELD,
  isReviewPending,
  reviewDecision,
  summarizeReview,
} from '@/domain/review'
import type { ReviewSummary } from '@/domain/review'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export type RunActionOptions = {
  /** 页面渲染该按钮时的行版本；与当前版本不一致说明有并发动作先落地了。 */
  expectedRev?: number
  /** 复核后再提交时登记的现场调查结论；与室内审核冲突时以它为准。 */
  fieldConclusion?: string
}

export function runAction(
  key: string,
  id: number,
  action: string,
  options: RunActionOptions = {},
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const current = String(row.status)
  const currentRev = typeof row.rev === 'number' ? row.rev : 1

  if (meta.review) {
    // 乐观锁：提交审核与要求复核并发时，只有持有最新 rev 的那个动作能落地。
    if (typeof options.expectedRev === 'number' && options.expectedRev !== currentRev) {
      return {
        ok: false,
        conflict: true,
        message: `该记录刚被另一个操作变更（审核/复核并发），本次「${action}」未执行，请刷新后重试`,
      }
    }
    const decision = reviewDecision(current, action)
    if (!decision.allowed) {
      return { ok: false, message: decision.reason }
    }

    const patch: EntryRow = { ...row }
    if (decision.requiresFieldConclusion) {
      const conclusion = (options.fieldConclusion ?? '').trim()
      if (!conclusion) {
        return {
          ok: false,
          message: '复核后再提交必须先登记现场调查结论，冲突时以现场调查结论为准',
        }
      }
      // 以现场调查结论为准：结论随本次提交一并落库，室内审核意见不得覆盖它。
      patch[FIELD_CONCLUSION_FIELD] = conclusion
    }

    const updated: EntryRow = {
      ...patch,
      status: decision.target,
      pending: isReviewPending({ ...patch, status: decision.target }),
      abnormal: false,
      rev: currentRev + 1,
    }
    const next = [...rows]
    next[index] = updated
    saveRows(key, next)
    return { ok: true, message: `${meta.entity}已${action}，当前状态「${decision.target}」` }
  }

  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
    rev: currentRev + 1,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 共用审核规则驱动的模块汇总：页面指标、看板、侧栏都取这一份结果。 */
export function reviewSummary(key: string, month: string): ReviewSummary {
  const meta = moduleMeta(key)
  if (!meta.review) {
    throw new Error(`${meta.name}没有接入共用审核规则`)
  }
  return summarizeReview(listRows(key), meta.review, month)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(now: Date = new Date()): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const reviewTodos = [...MODULE_BY_KEY.values()]
    .filter((meta) => Boolean(meta.review))
    .map((meta) => {
      const summary = summarizeReview(
        rows[meta.key] ?? [],
        meta.review!,
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      )
      return {
        key: meta.key,
        name: meta.name,
        awaitingReview: summary.awaitingReview,
        awaitingRecheck: summary.awaitingRecheck,
      }
    })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    {
      label: '复核待办',
      value: reviewTodos.reduce((sum, item) => sum + item.awaitingReview + item.awaitingRecheck, 0),
    },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules, reviewTodos }
}
