# 非战斗功能域分目录与拆分

> 状态：成就域专项、双端构建与原生冒烟通过，技能等超800行方案待审（一号 · main · 2026-10-30）
> 船长原话：「继续之前的功能域分目录与拆分，将战斗功能外的其他功能逐步拆分」。
> 范围/不做：延续已确认的core/data/renderer分层和功能域目录，按域推进；只整理职责与引用，不加功能，不改数值、玩家文案、随机消费、同拍顺序或存档结构，不读历史归档或个人档。
> 待裁决点：第二批及后续超800行文件的具体拆分方案；未经确认不改这些文件。

## 执行边界

- 当前指令延续各功能域目录整理的授权；每批只处理一个功能域及其必要共享引用、工具和测试，独立验证。
- 沿用已迁移域的具名兼容出口，域内直引实际实现；旧路径不留第二份逻辑，不使用聚合出口反向依赖。
- 行数按物理行统计。生产文件超800行先出职责方案，不能只搬目录掩盖体量，也不为改一行入口顺手改大文件。
- 本批不动2031行App、1600余行core公开导出及共享state/types/save；通过兼容出口保持入口和类型身份。
- 只本地提交，上一阶段已执行的推送许可不扩展到本轮未验收工作。

## 第一批：成就域

同类参照：现有`combat/`、`features/combat/`按层分域与旧路径具名转导出。涉及core、data、renderer属于同一成就功能域。

| 原文件 | 物理行数 | 实际实现目标 |
|---|---:|---|
| `packages/core/src/achievements.ts` | 141 | `achievements/rules.ts` |
| `packages/data/src/achievements.ts` | 309 | `achievements/catalog.ts` |
| `renderer/src/pages/AchievementsPage.tsx` | 18 | `features/achievements/AchievementsPage.tsx` |
| `renderer/src/panels/Achievements.tsx` | 123 | `features/achievements/Achievements.tsx` |

四份原文件保留具名兼容出口；core引擎与data上下文改直引实际实现。保留徽章表顺序、中文和英文覆盖、时刻、隐藏判据、去重与纯展示副作用边界；不抽出共享Glyph的成就图案或共享类型以扩大本批范围。

验证：成就、铁人及语言覆盖专项；补公开API身份、实际页面输出和目录不超线检查；类型、内容、本地化、UI和架构护栏，双端构建。结构检查只针对本批目录，不宣称全仓达标。

## 第二批候选：技能域（具体拆分待审）

| 文件 | 物理行数 | 建议职责 |
|---|---:|---|
| `packages/data/src/skills.ts` | 1214 | `skills/catalog.ts`保持原数组组合顺序；按原连续段提取定义，每份不超过800行；静态ID、前置和坐标保持 |
| `renderer/src/pages/SkillsTreePage.tsx` | 942 | `features/skills/SkillsTreePage.tsx`保留状态与事件编排；`SkillBoostBlock.tsx`保留增效显示；按现有JSX职责提取科技树画布和详情/队列视图，props显式，不新增取数或副作用 |
| `packages/core/src/skillQueue.ts` | 772 | 已低于上限，可归`skills/queue.ts`，训练与许可对应`training.ts`、`license.ts`，先保留原函数边界 |

风险：按分支拆表不得重排依赖或改变查找顺序；组件提取不得改变Hook顺序、事件闭包、队列动作与几何测量。验证技能目录逐字等价、训练大/小步与许可专项、科技树布局/引用及真实渲染；新单点仍按登记流程维护。

### 技能域可执行边界

- 数据表只导出三个既有公开值/函数及分支表，原`SKILLS`为顺序数组。按现有连续段拆`shipOperations.ts`（原73至233行）、`industry.ts`（234至660）、`combat.ts`（661至851）、`engineering.ts`（852至995）、`tradeExplorationLogistics.ts`（996至1206），各段条目顺序不动；组合文件显式按原段顺序展开。段内的实际group/branch字段原样保留，不能为目录美观重排。
- 分支表归`skills/branches.ts`，组顺序与`buildSkillCatalog`留`skills/catalog.ts`，坐标归`skills/positions.ts`；旧文件保留具名出口。数值、说明、ID和真前置逐条等价，不写新文案或英文。
- 页面先提`SkillBoostBlock.tsx`与其图标辅助（原74至171）、`SkillTreeCanvas.tsx`（原596至704的树画布）、`SkillDetailModal.tsx`（原811至937的详情）。搜索、页签、组/分支选择、滚动ref、外部定位、许可确认、前置入队和现有memo/effect继续在页面拥有；抽出组件显式传所需值和回调，不能复制这些状态。
- 详情浮层仍位于树/队列/增效三种子页分支之外；换子页不吞详情，画布与列表共用同一状态判据。提取不增加包装DOM、不改class和提示机制，不拆成一个巨型任意上下文参数。
- 页面目标约500至650行，增效约100行、画布约120行、详情约150行，辅助类型按真实依赖命名；实际实施以语法节点边界为准，不按行号截断。若依赖核查推翻此边界，先修订方案，不扩大授权。
- 同步检查导出、内容工具、技能布局与源码取证的引用；大体量App/index/state等仍通过兼容出口接入，未经独立方案不动。

## 第三批候选：工业域（具体拆分待审）

| 文件 | 物理行数 | 建议职责 |
|---|---:|---|
| `core/src/industry.ts` | 1524 | `industry/refining/{params,view,start,advance,stop}.ts`；销售、买船和碎片兑换原为混合职责，先列依赖和目标归属，再按原调用顺序移出，不改消费规则 |
| `core/src/manufacturing.ts` | 999 | `industry/manufacturing/{blueprints,materials,start,advance,view}.ts`，投料账与图纸占用单点共用，避免start/advance反引 |
| `renderer/src/pages/IndustryPage.tsx` | 1519 | `features/industry/`下页面、精炼卡、实验室卡与副面板，局部状态归原所有者 |
| `renderer/src/pages/IndustryHudPage.tsx` | 1757 | 控制台编排、产出环、原料读数、AI选择与工作列分别成文件；保留两套工业入口 |
| `renderer/src/panels/Industry.tsx` | 1821 | 蓝图书架、制造卡、制造列表与展示辅助独立，保留原排序及缺料/停机提示 |

风险：整批扣料、退料、一次性图纸、手动/AI工位、循环、离线统计与停靠预检必须保持。先画私有依赖，再拆无副作用辅助和视图，最后迁启动/推进编排，每份不超过800行。

## 第四批候选：市场域（具体拆分待审）

| 文件 | 物理行数 | 建议职责 |
|---|---:|---|
| `core/src/market.ts` | 2382 | `market/{pricing,access,supply,orders,settlement,trading,holdings}.ts`；周期推进、订单匹配和结算保持原调用顺序，公用低层纯函数不反引交易入口 |
| `data/src/marketCatalog.ts` | 1803 | `market/catalog.ts`保持显式组合；静态JSON绑定、派生商品、蓝图商品与渠道配置按原分组拆，ID和顺序不改 |
| `renderer/src/pages/MarketPage.tsx` | 1483 | `features/market/`下商品行、列、详情、价格图、我的订单与页面编排，筛选/选中/订单草稿状态仍归原所有者 |

风险：价格与税、限额额度、托管退款、自然库存锁定、市场收入计数及确定随机序列不得分叉；专项与固定种子交易轨迹差分后再构建。

## 后续域

物品、采矿打捞、星图航行、运输任务、站点、通讯、星球/星系及共享保存胶水继续逐域登记；本轮只列目录元信息，不通读全部源码，也不把尚未检查的文件当作已审范围。

## 结果

- 第一批成就域四份实现迁入独立目录，旧入口只保留具名兼容出口；必要调用点直引实现，范围表补新目录。
- 4文件84项专项通过：既有成就36项、铁人20项、语言覆盖24项，以及新增4项目录/API身份和中英真实React静态页面验证。含既有成就存档往返，不读个人档；页面测试替换通用外壳、图标、悬停与时间格式边界，不冒称桌面原生验收。
- 迁移前后四份实现剥除import语句后正文逐字相同；没有修改静态JSON、本地化表、存档字段或玩法。新目录最长309行。
- 四包类型与架构F1至F9通过；桌面、网页构建通过，保留既有perf混合导入、Vite CJS及大包提示。
- `node tools/achievements-desktop-smoke.cjs`隐藏桌面产物检查通过：独立临时userData与合成档，中英文各81枚可见/13枚已获得，未得铁人徽章隐藏；运行异常0，真实IPC保存与重载保持成就时刻和去重账。工具只关闭自建PID并清理已验证范围的临时目录，未读个人档；报告在忽略目录`tools/_ui-artifacts/achievements-desktop-smoke.json`。
- 严格UTF8与冲突标记检查通过，未审的超800行文件未改。完整core回归留待船长明确开始集中验收，提交走现有四项钩子，不跳过。
- 超800行方案在船长明确确认前只保留本文，不修改对应生产代码。后续从技能域开始逐批确认与验证，不把成就迁移宣称为全部非战斗域完成。
