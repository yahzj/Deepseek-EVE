# 大鲸鱼 · 深空工业

以《EVE 星战前夜》为蓝本的**文字挂机游戏**（桌面端为主、可构建网页版）：练技能、挖矿精炼、
造装备造船、跑悬赏打实时战斗、在市场里做贸易，全部在挂机循环里推进。

> **本页只写"怎么跑起来"与"现在有什么"。** 逐批开发过程与每个系统的当前口径见
> [`docs/roadmap.md`](docs/roadmap.md)（追加式批次日志，最新在最上）与 [`docs/design/`](docs/design/)；
> AI/协作约定见 [`AGENTS.md`](AGENTS.md)。（M0~V12 的逐里程碑流水已在 2026-09-11 的文档体检中
> 从本页移除——那些内容全部在 roadmap 与 design 里，本页不再维护第二份。）

## 现在的形态（2026-09-10 口径）

| 系统 | 现状 |
|---|---|
| 技能与时间 | 训练队列（**78 项技能 / 7 组**：舰船·工业·战斗·工程·贸易·探索·物流；rank1~4）、离线结算（上限 8 小时）、版本化存档自动迁移与损坏容错 |
| 采矿与精炼 | **17 条矿带**（矿石/气体/冰矿）自动循环采掘、富矿脉彩头；精炼炉多工位（主控亲自 1 台 + 每枚闲置 AI 核心一台） |
| 制造与工业 | 蓝图制造（**装备 89 张 + 舰船 24 张**）、组装机（可循环制造）、工业专用 AI 工位（满技能站内 20 位） |
| 舰船与装配 | **25 艘舰船**（掠食者武装 / 甲壳重装 / 蜃楼航运 / 鲸盟采矿）、六槽装配、**98 件装备** |
| 星图与远征 | **20 个星系**、悬赏任务与窝点、空间站与副站建设、每日轮换的「敌对派系活跃」 |
| 实时战斗 | 三层承伤（护盾/装甲/结构）× 三系克制、距离动力学与四种战术、弹药与修理组件消耗、无人机四型（可损毁可回收）、推进器周期点火 |
| 市场 | **281 张商品卡**：NPC 订单簿 + 站内库存池（淤积压价/断货涨价）+ 稀有度分层的稀有订单与奇货渠道、贸易税 |
| AI 副船 | 采矿 / 打捞 / 驻留待命循环（远征已软下线、代码保留），与站内工业**共用** AI 核心启用上限 |
| 玩家侧文档 | 游戏内手册与教程、更新公告；内容工作台（Excel/WPS 双向编辑内容数据） |
| 开发侧工具 | 四连验证（typecheck / test / content:check / build）+ 十余个经济与战斗校准脚本（见下表） |

## 在线网页版（GitHub Pages）

- 同一份代码可构建为纯浏览器可玩的网页版（独立工程 `web/`：`cd web && npm ci && npm run build`，
  只装 react/vite、不装 Electron），由 GitHub Actions（`.github/workflows/pages.yml`）自动部署；
- 网页版存档保存在浏览器 localStorage（自带备份/恢复面板），与桌面版文件存档相互独立；
- 推送 main 分支即触发部署：仓库 Settings → Pages → Source 选 **GitHub Actions** 即可。

## 环境要求

- Node.js ≥ 20（开发环境实测 v26）
- npm（建议 10+，实测 11）

## 快速开始

```bash
# 1. 安装依赖（本仓库已装好则跳过；首次或换机器需要）
npm install

# 2. 启动游戏（开发模式，带热更新）
npm run dev
```

开发模式下会自动打开游戏窗口。**关闭窗口 = 退出**，进度靠自动保存（每 15 秒
+ 每次操作后 + 启动时）。

> 首次 `npm install` 若 Electron 下载卡住（国内网络），在命令前设置：
> ```powershell
> $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
> npm install
> ```
> 有代理则在命令前加：`$env:HTTP_PROXY="http://127.0.0.1:7897"; $env:HTTPS_PROXY="http://127.0.0.1:7897"`

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式启动游戏（热更新） |
| `npm run test` | 运行核心引擎单元测试 |
| `npm run typecheck` | 全部子项目 TypeScript 类型检查（core/data/ui/desktop） |
| `npm run content:check` | 内容完整性体检（市场/配方/引用无死物品 + 各类数据契约） |
| `npm run build` | 构建生产版（产物在 `apps/desktop/out`） |
| `npm run build && npm run start -w @whale/desktop` | 以生产版启动 |
| `npm run balance` | 长时无人值守经济模拟（三策略 × 24h 对比） |
| `npm run battle:calibrate` | 战斗标定矩阵（舰船 × 悬赏卡 × 技能档） |
| `npm run battle:mixed-review` | 敌方混伤复核（A~G 段） |
| `npm run bounty:econ` | 悬赏/窝点/高级箱经济期望 |
| `npm run salvage:econ` | 打捞与回收经济期望 |
| `npm run manufacture:econ` | 制造与精炼经济（含「料 ÷ 现货价」锚线） |
| `npm run price:audit` | 装备价 vs 同级武器价对照 |
| `npm run liquidity:audit` | 市场物品池覆盖比（玩家产能 vs 池吸收） |
| `npm run faction:audit` | 派系活跃候选池与窝点盘点 |
| `npm run content:export` / `npm run content:import` | 内容工作台：导出工作簿 / 回写并校验 |

（另有若干按需工具未挂 npm script：`tools/market-rarity-sim.ts`、`tools/playthrough-sim.ts`、
`tools/drone-vs-gun.ts`、`tools/hit-profile.ts`、`tools/pd-tune.ts`、`tools/firepower-curve.ts`、
`tools/foe-hp-table.ts`、`tools/loop-stop-check.ts`、`tools/make-test-save.ts` 等。）

## 目录结构

```
apps/desktop      桌面外壳（Electron：窗口、存档读写、界面）
packages/core     引擎核心（纯 TypeScript，无框架依赖——所有游戏规则都在这里）
packages/data     静态内容数据（技能/物品/装备/舰船/敌人/矿带/市场等；加内容 = 加数据，引擎零改动）
packages/ui       界面组件库（面板/进度条/日志，EVE 风样式）
tools/            开发与校准脚本（经济、战斗、内容体检、测试存档）
web/              在线网页版独立工程（见上）
docs/             架构、设计稿、术语词典、批次日志与评审件
```

## 存档位置

Windows：`%APPDATA%\whale-idle\save.json`（卸载重装游戏也不丢）。
重置档案在游戏右上角"重置档案"按钮。

## 文档入口

| 想知道什么 | 看哪里 |
|---|---|
| 某个功能做到哪了、某次改动的前因后果 | [`docs/roadmap.md`](docs/roadmap.md)（批次日志，最新在最上） |
| 某系统的设计口径与数值 | [`docs/design/`](docs/design/)（各系统设计稿；同主题取日期最新的一份） |
| 术语、字段、机制名词 | [`docs/glossary.md`](docs/glossary.md)（术语权威） |
| 架构与模块边界 | [`docs/architecture.md`](docs/architecture.md) |
| 开发/协作/验证/公告纪律 | [`AGENTS.md`](AGENTS.md) + [`docs/development-conventions.md`](docs/development-conventions.md) |
| 可复现测试存档 | [`docs/test-saves/`](docs/test-saves/)（配合 `tools/make-test-save.ts`） |
