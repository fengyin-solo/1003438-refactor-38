.PHONY: install frontend build check

# 本地开发环境：先过 doctor（示例数据 / 旧记录迁移 / 并发互斥 / 复核待办同步检查）再起服务
install:
	cd frontend && npm install

check:
	cd frontend && npm run doctor

frontend:
	cd frontend && npm run dev

# 构建检查：doctor + 类型检查 + 生产构建，一条命令跑完
build:
	cd frontend && npm run build
