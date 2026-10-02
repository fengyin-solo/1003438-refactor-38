import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  auditMetrics,
  auditTargetOf,
  availableAuditActions,
  canTransition,
  isAbnormalStatus,
  isPendingStatus,
  rejectAudit,
  runAuditTransition,
} from '@/domain/audit'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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

function applyAuditAction(
  meta: ModuleMeta,
  id: number,
  action: string,
  expectedStatus: string,
): ActionResult {
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  // 乐观并发校验：以发起动作时页面所见状态为准，落库前比对最新状态。
  // 提交审核与要求复核基于同一状态并发时，后落地的一方会发现状态已被改写，直接拒绝。
  const latestStatus = String(rows[index].status)
  if (latestStatus !== expectedStatus) {
    return {
      ok: false,
      message: `该记录状态已被另一个审核动作更新为「${latestStatus}」，本次「${action}」未生效`,
    }
  }
  if (!canTransition(latestStatus, action)) {
    return rejectAudit(meta, latestStatus, action)
  }
  const target = auditTargetOf(action) as string
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: isPendingStatus(target),
    abnormal: isAbnormalStatus(target),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(meta.key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/**
 * 审核流动作入口（异步）：
 * - 调用方必须传 expectedStatus（点击按钮时该行展示的状态）；
 * - 并发闸门保证同一条记录同一时刻只有一个审核动作在落地；
 * - 闸门内再按最新状态做乐观校验，双保险保证「提交审核 / 要求复核」并发时只落一个状态。
 */
export async function runAuditAction(
  key: string,
  id: number,
  action: string,
  expectedStatus: string,
): Promise<ActionResult> {
  const meta = moduleMeta(key)
  if (!meta.auditFlow) {
    return runAction(key, id, action)
  }
  if (!auditTargetOf(action)) {
    return rejectAudit(meta, expectedStatus, action)
  }
  const gated = await runAuditTransition(key, id, action, () =>
    applyAuditAction(meta, id, action, expectedStatus),
  )
  if (!gated.ok) {
    return gated.conflict as ActionResult
  }
  return gated.result as ActionResult
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  return runGenericAction(meta, id, action)
}

function runGenericAction(meta: ModuleMeta, id: number, action: string): ActionResult {
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(meta.key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(meta.key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 规则驱动：页面按行渲染当前状态允许的动作，未接入审核流的模块返回动作全集。 */
export function actionsForRow(meta: ModuleMeta, row: EntryRow): string[] {
  if (meta.auditFlow) {
    return availableAuditActions(row)
  }
  return meta.actions
}

/** 林木生长的共用汇总口径：样地去重、待审核、复核待办、归档、本月录入。 */
export function treegrowthSummary(): ReturnType<typeof auditMetrics> {
  return auditMetrics(listRows('treegrowth'))
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

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    if (meta.auditFlow) {
      // 待处理 = 待审核 + 复核待办；异常量 = 复核待办。口径来自共用审核规则。
      const metrics = auditMetrics(entries)
      return {
        name: meta.name,
        created: entries.length,
        pending: metrics.pendingReview + metrics.recheckCount,
        abnormal: metrics.recheckCount,
      }
    }
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
