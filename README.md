# 森林防火巡护管理系统

面向森林火险监测、巡护任务调度、防火设施维护与应急响应指挥的林区防火管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/domain/audit.ts        共用审核规则：状态机、汇总口径、并发闸门
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化 / 旧记录迁移
│   ├── scripts/doctor.mjs    本地与构建共用的检查脚本（示例数据 / 迁移 / 并发 / 待办同步）
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── Makefile                  install / check / frontend / build 统一入口
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

`npm run dev` 会先跑一遍 `npm run doctor`（本地检查），通过后才启动 dev server；
`npm run build` 同样把检查、类型检查、生产构建串在一条流程里。也可以单独执行：

```bash
npm run doctor      # 示例数据 / 旧记录迁移 / 并发互斥 / 复核待办同步 共 11 项检查
# 或在仓库根目录
make check          # 同 doctor
make build          # doctor + 类型检查 + 生产构建
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 巡护任务 | `patrol` | 巡护任务 | 任务编号、巡护区域、巡护路线 |
| 火险监测 | `firewatch` | 火险监测点 | 监测点编号、监测区域、火险等级 |
| 瞭望台管理 | `lookout` | 瞭望台 | 瞭望台编号、所在山头、海拔高度 |
| 防火隔离带 | `firebreak` | 防火隔离带 | 隔离带编号、所属林区、起止坐标 |
| 扑火队伍 | `fireteam` | 扑火队伍 | 队伍编号、队伍名称、所属林场 |
| 消防装备 | `equipment` | 消防装备 | 装备编号、装备名称、装备类型 |
| 气象观测 | `weather` | 气象观测记录 | 记录编号、观测站点、观测时间 |
| 火情报告 | `firereport` | 火情报告 | 报告编号、起火地点、起火时间 |
| 无人机巡查 | `drone` | 无人机巡查任务 | 任务编号、飞行区域、飞行路线 |
| 防火宣传 | `campaign` | 防火宣传活动 | 活动编号、宣传主题、宣传方式 |
| 防火检查站 | `checkpoint` | 防火检查站 | 站点编号、站点位置、值守人员 |
| 值勤排班 | `duty` | 值勤排班表 | 排班编号、值勤日期、值勤时段 |
| 物资储备 | `supply` | 防火物资 | 物资编号、物资名称、物资类别 |
| 林区道路 | `forestroad` | 林区道路 | 道路编号、道路名称、起点位置 |
| 防火林带 | `firebelt` | 防火林带 | 林带编号、林带名称、所属林区 |
| 应急演练 | `drill` | 应急演练 | 演练编号、演练主题、参演队伍 |
| 焚烧审批 | `burnpermit` | 用火审批单 | 审批编号、申请单位、用火类型 |
| 林木生长 | `treegrowth` | 林木生长记录 | 记录编号、样地编号、林分类型 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `forest-fire-patrol:entries` 这一项，或调用 `resetModule(模块)`。

## 林木生长共用审核规则

林木生长记录的审核、复核、归档只有一份规则，集中在 `frontend/src/domain/audit.ts`，
页面动作、看板汇总、示例数据与旧记录迁移全部从它取口径：

- 状态机：`已录入 →提交审核→ 已审核`；`已审核 →要求复核→ 需复核`；
  `需复核 →采纳现场结论→ 已审核`；`已审核 →确认记录→ 已归档`。已归档为终态，不可再操作。
- 冲突时以现场调查结论为准：复核有异议时不覆盖现场结论，而是走「采纳现场结论」落回已审核。
- 历史林分类型按当时标准保留：迁移与任何流转都不改写「林分类型」字段。
- 汇总口径唯一：样地数量按「样地编号」去重（同一样地多次调查只算一个），待审核 / 复核待办 /
  已归档 / 本月录入（按调查日期）都由 `auditMetrics` 计算，页面不再各 filter 一遍；
  新规则落地后，林木生长页与运营概览通过 `subscribeRows` 订阅同步刷新（含跨标签页）。
- 并发互斥：`runAuditAction` 要求调用方带上发起动作时所见的状态，落库前比对最新状态，
  并经同记录并发闸门串行化；「提交审核」与「要求复核」同时发生时只允许一个状态落地，
  另一方收到冲突提示。

## 本地数据版本与旧记录迁移

- 本地存储结构带版本号（`DATA_SCHEMA_VERSION`，见 `frontend/src/data/migration.ts`）。
- 打开应用时自动识别旧版裸结构并迁移：旧状态同义写法（如「复核中」「已封存」）归一到现行状态，
  未知状态回退「已录入」重走流程；`pending/abnormal` 按共用规则重算；迁移结果立即写回。
- 迁移只补结构与派生标记，**不动林分类型等现场字段**；示例数据新增的行会补齐，浏览器中
  已有的记录原样保留。
- `npm run doctor` 把示例数据自检与迁移自检纳入同一条本地/构建流程。
