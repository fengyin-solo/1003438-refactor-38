.PHONY: install dev frontend build verify check clean

# 本地开发环境：装依赖（示例数据随 src/data/seed.ts 播种，旧记录启动时自动迁移）
install:
	cd frontend && npm install

# 本地开发服务器
dev frontend:
	cd frontend && npm run dev

# 构建检查：类型检查 + 审核规则/迁移/并发校验 + 生产构建，一条命令跑完
check:
	cd frontend && npm run check

# 仅业务校验：状态机、CAS 并发、旧记录迁移、复核待办汇总
verify:
	cd frontend && npm run verify

# 仅生产构建（含 vue-tsc 类型检查）
build:
	cd frontend && npm run build

clean:
	rm -rf frontend/dist frontend/scripts/.verify-build.mjs
