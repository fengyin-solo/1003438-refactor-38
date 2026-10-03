/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 乐观锁版本号：每次状态变更 +1，并发提交时只有一个 rev 能落地。 */
  rev?: number
  [field: string]: string | number | boolean | undefined
}

/**
 * 共用审核规则配置：只有接入审核/复核/归档流的模块才挂这份配置。
 * 规则本身见 src/domain/review.ts，这里只描述模块字段。
 */
export type ReviewMeta = {
  statuses: string[]
  actions: string[]
  /** 样地（或同类调查单元）编号字段，去重统计统一用它。 */
  plotField: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 挂了这份配置的模块，动作流转走共用审核状态机。 */
  review?: ReviewMeta
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 并发冲突时为 true，页面据此提示刷新后再操作。 */
  conflict?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
  /** 共用审核规则驱动的复核待办，所有入口展示同一个数。 */
  reviewTodos: { key: string; name: string; awaitingReview: number; awaitingRecheck: number }[]
}
