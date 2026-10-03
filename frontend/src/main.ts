import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { useReviewStore } from './stores/review'
import './styles/global.css'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)
app.mount('#app')

// 订阅本地数据变更，驱动看板、侧栏与各审核入口的复核待办同步。
useReviewStore(pinia).bind()
