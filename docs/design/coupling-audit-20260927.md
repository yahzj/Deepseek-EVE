# 五大功能耦合性体检（2026-09-27 · 二号 · d2）

状态：**待办 · 船长 2026-09-27 令「先等三号重构完一些规则和护栏」** ⇒ 本批**只留数据与建议，不动任何规则/护栏代码、不新建工具**。

船长原话（照抄）：
- 「**现有的几个大功能耦合性怎么样？战斗-虫洞-入侵-工业-市场**」
- 「**先等三号重构完一些规则和护栏**」

## 〇、方法（只读，未改任何业务代码）

在 `d2/workspace` 上量了四组数：① 各域行数 ② 域间 `import` 边（解析每个文件的相对 import）③ 共享词汇表（各工具模块被多少文件 import）④ 关键缝合点的调用点分布与近期提交的跨域比例。全部命令都只读源码与 git 历史。

## 一、体量（`packages/core/src` 共 **60,400 行**）

| 域 | 行数 | 主要文件 |
| --- | --- | --- |
| 战斗 | **16,987** | `combat.ts` 8,983 · `expedition` 1,870 · `salvage` 1,365 · `ai` 1,227 · `encounters` 968 |
| 共享底座 | **15,799** | `save` 3,977 · `state` 3,265 · `types` 2,953 · `index` 1,842 · `engine` 972 |
| 虫洞 | **10,101** | `wormholeSalvage` 2,194 · `wormhole` 1,744 · `wormholeBattle` 1,185 · 其余 8 个 |
| 市场 | **5,771** | `market` 2,101 · `equipment` 1,246 · `shipyard` 890 · `inventory` 291 |
| 入侵 | **3,415** | `weekendEvent` 1,552 · `weekendBattle` 960 · 其余 3 个 |
| 工业 | **2,826** | `industry` 1,305 · `manufacturing` 821 · `mining` 700 |

**底座比任一功能都大** —— 这本身就是一种耦合形态：五大功能挂在同一棵树、同一套类型上。

## 二、依赖图

| 关系 | 事实 |
| --- | --- |
| **双向依赖（7 对）** | `战斗 ↔ 虫洞` · `战斗 ↔ 入侵` · `战斗 ↔ 工业` · `战斗 ↔ 市场` · `虫洞 ↔ 入侵` · `虫洞 ↔ 工业` · `工业 ↔ 市场` |
| **单向（2 对）** | `虫洞 → 市场` · `入侵 → 市场` |
| **零耦合（1 对）** | **`入侵 × 工业`**（唯一互不引用的一对） |
| 跨域枢纽 | `engine.ts` 调全部 5 域 · `save.ts` 认 4 域 · `activity.ts` 认 4 域 · `encounters.ts` 与 `wormholeBattle.ts` 各认 3 域 |
| 边界缺失 | `index.ts` 是 **1,842 行桶文件**，任何模块都能引任何模块 ⇒ 没有可依的边界 |
| 桌面侧 | `apps/desktop/src/renderer/src/game/engine.ts` **3,845 行**，从 `@whale/core` 一次引 **260 个符号**，五个域全用 |

**共享词汇表**（被最多文件 import 的工具模块）：`state` 60 个文件 · `types` 59 · `inventory` 26 · `shipyard` 15 · `rng` 14 · `labels` 13 · `equipment` 13 · `tuning` 11 · `salvage` 11。

## 三、耦合分三类，健康度差别很大

**a. 工具型（健康）**：`addWare` / `streamOf` / `labels` 一类共享词汇。26 个文件调 `inventory` 属正常。
代价是改 `state.ts` / `types.ts` 要全仓复核。

**b. 状态型（隐患）**：全系统共用一棵 `GameState`，且**跨域直接改对方的子树** ——
`wormholeBattle` 直接写 `state.fleet` · `combat` 直接写 `state.wormhole` · `equipment` 也写市场订单表。
没有任何工具拦"越域写"。

**c. 缝合点型（当前最大风险）**：**四个战斗宿主**（远征 / 遭遇 / 虫洞 / 入侵旗舰）各自要走完
"推进 → 收尾 → 结算 → 发奖与日志"：

| 指标 | 读数 |
| --- | --- |
| `advanceBattleFor` 调用点 | **6 个文件**（ai · combat · encounters · expedition · winEstimate · wormholeBattle） |
| `weekendApplyBattleOutcome` 调用点 | **3 个文件共 7 处**（encounters 4 · expedition 2 · weekendBattle 1） |
| `settle*` 家族 | **约 15 个入口 · 6 个文件**（encounters 的 `settleEncounterBattle` / `settleEncounterTail` / `settleFight` / `settleEscape` · expedition 的 `settleBattleRetreat` · wormholeBattle 的 `settleWormholeBattle` · wormholeAuto 的 `settleRun` · weekendBattle 的 `weekendApplyBattleOutcome` / `weekendSettleAndGrant` · sideTasks 两个 · market 五个） |

⇒ **漏调一处 = 一整场的伤害 / 判沉 / 掉落 / 日志全丢**。近期六个 bug 全是这个形状：

| Bug | 缝合点 | 出处 |
| --- | --- | --- |
| 击杀无黑匣 | 两条"章鱼到点"路径只有一处掷骰 | 2026-09-26 报障（二号修） |
| 窗口到点旗舰战整场作废 | 结算侧以"本场已结束"提前回落 | 2026-09-26 模拟查出（二号修） |
| 支援舰入场却不参战 | 召唤方写 `battle.units`，参战列表只认编成表 | 2026-09-27 玩家报障（二号修） |
| 战利品落点 / 遭遇战收尾两支路不同源 | 进函数时"战斗已结束"那一支漏结算 | 一号 `b35b4f55` |
| 虫洞重入要手动点才开始结算 | 另一条收尾路径没跟上 | 一号 `f34ea621` |
| 撤离不当拍结算 | 同上 | 一号 `7cfab443` |

**d. 时序型**：`advanceGame` 一拍固定跑 20+ 个 `advance*`（技能→采矿→打捞→漂移→返航→制造→精炼→远征→虫洞→**入侵章鱼**→扫描→自动虫洞→运输→AI→遭遇→随机事件→市场→任务→通讯），且**跨域传旗标**：章鱼那一拍要同时读 `isPlayerInBattle(state)` 与 `weekendFlagshipBattleActive(state)`。顺序或旗标一变行为就变 —— 2026-09-27 两处都是这类：结算必须跑在 tick 之前、阵亡收集必须在召唤之后取列表。

## 四、改动统计（近 120 笔提交）

碰核心的 28 笔里，**跨 ≥2 个域的有 9 笔（32%）**，其中 **7 笔都带"入侵"**
（`ae32a1f6` · `e138736a` · `d11bf2ee` · `8d204d2a` · `4c27c838` · `f30d986a` · `b35b4f55`）
⇒ **入侵是最"缝合"的系统**：它自己没有战斗引擎、没有市场、没有仓库，全靠借战斗＋市场＋虫洞的读数。

## 五、四条建议（按收益排序 · **暂不动手**）

1. **收尾单点**：把"一场战斗结束后必须做的事"收成一处（伤害台账 / 判沉 / 掉落 / 日志 / 结算），宿主只交上下文。15 个 `settle*` 入口正是四个宿主各写一遍的产物，也是近三天所有 bug 的来源。
2. **域写权纪律**：每个域的状态子树只许本域写，跨域只能调入口。
3. **跨域 import 白名单**：把"五个域之间允许的依赖方向"钉成契约，新增反向依赖即红。
4. **只读体检工具**（原拟名 `arch:audit`）：扫跨域 import / 跨域写状态 / 收尾入口的调用点覆盖，挂进闸门看"这一批有没有新增缝合点"。

## 六、与三号护栏重构的关系（本次挂起的原因）

- 第 2 / 3 / 4 条本质都是**规则与护栏**，与三号正在重构的那一块**同域** ⇒ 本批**不做**，避免两套口径/两套工具并存；
- 本文件只留**数据与建议**，等三号落地后再看：哪些已被覆盖（那就删掉对应建议）、哪些还值得补；
- **不做的事**：不改任何规则/护栏/契约代码、不新建体检工具、不动 `index.ts` 与 `state.ts` 的结构。
