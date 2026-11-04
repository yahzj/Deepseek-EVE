# 大鲸鱼-深空放置

以《EVE 星战前夜》为蓝本的**文字挂机游戏**（桌面端为主、可构建网页版）：练技能、挖矿精炼、
造装备造船、跑悬赏打实时战斗、在市场里做贸易，全部在挂机循环里推进。

> 本页提供运行入口，当前工作从[`AGENTS.md`](AGENTS.md)和[`docs/catalog.md`](docs/catalog.md)开始。
> **没有船长明确查阅要求，平时工作禁止阅读、检索、扫描或自动载入`docs/archive/`、`docs/design/archive/`及其他历史留档，也不得绕查Git历史。**原因：旧方案和过期授权不能混入当前依据。

## 版权与授权

作者：ya（GitHub：yahzj）。公开游玩和查看代码不自动授予复制改名、移除署名或第三方再发布的许可，详见[`LICENSE.txt`](LICENSE.txt)。既有许可、第三方组件各自的许可证及法定例外不受影响。

生产构建附带`LICENSE.txt`、`copyright.html`和`THIRD-PARTY-NOTICES.txt`，渲染包JavaScript（含Worker）保留简短版权头；网页HTML通过`rel="license"`指向独立版权页，不给游戏界面增加弹窗或操作限制。构建与核查见[`tools/release-rights/README.md`](tools/release-rights/README.md)。这些声明不保证防止复制或让所有AI拒绝搬运。

## 当前系统入口

| 系统 | 现状 |
|---|---|
| 技能与时间 | 技能科技树、训练队列、离线结算；上限由当前技能和模式现算，存档兼容见架构文档 |
| 采矿与精炼 | 矿带采集、富矿脉、精炼与回收，多工位及AI核心调度 |
| 制造与工业 | 蓝图、组装机、造船厂、实验室与循环生产 |
| 舰船与装配 | 舰船实例、常规槽、插件、无人机与装配方案，数量以当前目录为准 |
| 星图与远征 | 星系、悬赏、窝点、空间站、敌对派系活跃和入侵；原型入口不等于公开玩法 |
| 实时战斗 | 三层承伤（护盾/装甲/结构）× 三系克制、距离动力学与四种战术、弹药与修理组件消耗、无人机四型（可损毁可回收）、推进器周期点火 |
| 市场 | 订单簿、库存池、稀有与奇货、限额供给及独立黑市 |
| AI 副船 | 采矿、打捞等自动工作，与站内工业共用AI核心启用上限，支持活动按当前代码确认 |
| 玩家侧文档 | 游戏内手册与教程、更新公告；内容工作台（Excel/WPS 双向编辑内容数据） |
| 开发侧工具 | 类型、内容、本地化、界面契约及专项测试，经济与战斗校准按任务运行 |

## 在线网页版（GitHub Pages）

- 同一份代码可构建为纯浏览器可玩的网页版（独立工程 `web/`：`cd web && npm ci && npm run build`，
  只装 react/vite、不装 Electron），通过统一手动发布入口部署；
- 网页版存档保存在浏览器 localStorage（自带备份/恢复面板），与桌面版文件存档相互独立；
- 代码和版本标签推送只同步仓库，不部署。上线时进入 Actions → **Publish (Manual)**，选择 `web`、`windows` 或 `both`，填写版本引用；Windows另需同提交的已推送版本标签。
- 仓库 Settings → Pages → Source 保持 **GitHub Actions**。发布、回退和部分失败处理见[统一发布说明](.github/RELEASING.md)；工作流修改上传默认分支之前，远端旧触发规则仍有效。

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

开发模式下会打开游戏窗口。关闭窗口退出；自动保存与写入保护由当前引擎和外壳实现，保存事务边界见架构文档。

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

其他工具按当前`package.json`及工具头部用法查阅；测试阶段与提交检查按开发约定执行。

## 目录结构

```
apps/desktop      桌面外壳（Electron：窗口、存档读写、界面）
packages/core     引擎核心（纯 TypeScript，无框架依赖——所有游戏规则都在这里）
packages/data     静态内容数据（技能/物品/装备/舰船/敌人/矿带/市场等；加内容 = 加数据，引擎零改动）
packages/ui       界面组件库（面板/进度条/日志，EVE 风样式）
tools/            开发与校准脚本（经济、战斗、内容体检、测试存档）
web/              在线网页版独立工程（见上）
docs/             现行架构、术语、设计与测试说明；archive为默认禁读旧记录
```

## 存档位置

Windows：`%APPDATA%\whale-idle\save.json`（卸载重装游戏也不丢）。
重置档案在游戏右上角"重置档案"按钮。

## 文档入口

| 想知道什么 | 看哪里 |
|---|---|
| 当前待办和未决事项 | [`docs/roadmap.md`](docs/roadmap.md) |
| 某系统的当前依据 | [`docs/catalog.md`](docs/catalog.md)按任务路由，再核实设计状态与实现；日期不决定有效性 |
| 术语、字段、机制名词 | [`docs/glossary.md`](docs/glossary.md)（术语权威） |
| 架构与模块边界 | [`docs/architecture.md`](docs/architecture.md) |
| 开发/协作/验证/公告纪律 | [`AGENTS.md`](AGENTS.md) + [`docs/development-conventions.md`](docs/development-conventions.md) |
| 可复现测试存档 | [`docs/test-saves/`](docs/test-saves/)（配合 `tools/make-test-save.ts`） |


## 授权协议与商业使用 (License)

本项目遵循 **双重授权模式 (Dual-Licensing Model)**，详情参见根目录 [`LICENSE`](LICENSE)：

1. **开源学习与社区使用 (GNU AGPLv3)**：
   遵循 [GNU Affero General Public License v3.0](LICENSE)。如果您在公开网络环境托管、分发或修改本游戏，**必须全量开源您的全部代码与修改内容**，并保留原作者署名与版权标识。
2. **商业运营与闭源免除 (Commercial License)**：
   严禁未经授权将本项目用于任何形式的商业盈利行为（包括但不限于商业化运营、私服收费、内置广告、售卖游戏道具、打包离线版商业分发等）。如需进行商业合作、闭源部署或获取免除 AGPL 限制的商业特许，请联系作者：
   - GitHub: [https://github.com/yahzj](https://github.com/yahzj)
   - 仓库地址: [https://github.com/yahzj/Deepseek-EVE](https://github.com/yahzj/Deepseek-EVE)
