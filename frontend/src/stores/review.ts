import { defineStore } from 'pinia'

import { loadOverview } from '@/api/local-service'
import { subscribeStore } from '@/data/local-store'
import type { OverviewResult } from '@/data/types'

type ReviewTodo = OverviewResult['reviewTodos'][number]

/**
 * 复核待办的唯一数据源：页面动作落地、数据重置、迁移完成后，
 * 数据层发变更事件，这里自动重算，看板、侧栏与各审核入口同步刷新。
 */
export const useReviewStore = defineStore('review', {
  state: () => ({
    todos: [] as ReviewTodo[],
    unsubscribe: null as null | (() => void),
  }),
  getters: {
    awaitingReview(state): number {
      return state.todos.reduce((sum, item) => sum + item.awaitingReview, 0)
    },
    awaitingRecheck(state): number {
      return state.todos.reduce((sum, item) => sum + item.awaitingRecheck, 0)
    },
    total(): number {
      return this.awaitingReview + this.awaitingRecheck
    },
  },
  actions: {
    refresh() {
      this.todos = loadOverview().reviewTodos
    },
    /** 挂载一次即可；订阅本地数据变更，任何入口的状态流转都会同步到待办。 */
    bind() {
      this.refresh()
      if (!this.unsubscribe) {
        this.unsubscribe = subscribeStore(() => this.refresh())
      }
    },
  },
})
