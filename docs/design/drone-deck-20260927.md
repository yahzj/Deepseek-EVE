# 无人机储备甲板（新装备）— 工作文档

- **状态**：进行中（2026-09-27 · 一号 · 主树 `main`）
- **来源**：船长新增需求（§2 四步闸门已走完：集中提问 → 设计总结 → 显式确认）。

## 船长原话（照抄）

> 添加无人机高槽装备，无人机储备甲板，效果是有无人机被摧毁时开始运转周期，满了之后立刻补充（复活）被摧毁一架无人机（从仓库补充）。复活的无人机可以重新加入战斗。

## 已确认决策（7 条）

| # | 决策 | 船长选择 |
|---|---|---|
| 1 | 槽位归属 | **甲（改判）**：新开**高槽族 `drone-deck`** —— 见下方"槽位冲突" |
| 2 | 档位与周期 | 三档 MK1/2/3，周期 **15 s / 10 s / 6 s** |
| 3 | 单件内多架被毁 | 单周期**串行**排队 |
| 4 | 货源与消耗 | **本舰货舱 → 物品仓库**，**同型才补** |
| 5 | 战损账 | `droneLost` **照记不回冲**；**净损失 = 损坏 − 回收 − 战中复活** |
| 6 | 生效范围 | 所有战斗（含离线折算） |
| 7 | 多件叠装 | **按需启动**：周期数 = `min(装了几件, 待补架数)`，优先周期最短的件 |

### 槽位冲突（§5.2 已呈船长裁决）

设计确认后、开工前发现另一个会话当天已按船长令落码：
`drone-rack`（无人机甲板扩展）**从高槽移到低槽**（`modules.ts` 注释「2026-09-27 船长令：扩舱件从高槽移到低槽」；
`labels.rackOf` 同步改 `low`），并新开了高槽族 `drone-relay`（无人机中继天线）。
⇒ 与"并入 `drone-rack` 族"＋船长原话"**高槽**装备"冲突。
**船长裁决：甲 —— 新开高槽族 `drone-deck`**（与 `drone-tac` / `drone-relay` 同槽竞争）。

## 数值

| | MK1 | MK2 | MK3 |
|---|---|---|---|
| id | `mod-drone-deck-1` | `mod-drone-deck-2` | `mod-drone-deck-3` |
| 名称 | 无人机储备甲板 MK1 / MK2 / MK3 | | |
| slot / rack | `drone-deck` / `high` | 同 | 同 |
| `droneReviveCycleMs` | **15000** | **10000** | **6000** |
| CPU | 10 | 24 | 50 |
| 稀有度 | common | rare | rare |
| 市价 | 22,000 | 520,000 | 2,600,000 |
| 蓝图 | `bp-drone-deck-1/2/3`：材料 42~45% 料/价 · 书价 = 产物 ×2 / ×2.5 / ×3 · 建造 200 / 900 / 2000 s | | |

## 机制（逐条）

1. **开战**：扫本舰**高槽**里带 `droneReviveCycleMs` 的模块，记下每件的周期。
2. **队列**：**全舰一条待补队列**（FIFO，按被击落顺序）；某架被击落即入队。
3. **按需启动**：只要「待补架数 > 正在跑的周期数」，就从空闲的件里取**周期最短**的那件启动
   （同档取槽位索引最小者）。⇒ 损失 1 架而装了两件时**只启动 1 条周期**，另一件不空跑。
4. **到点**：从队头取一架；该型**没库存则跳过、取下一个有货的型别** ⇒ 三层血按 `maxS/maxA/maxH`
   **满血**、`alive=true`、`inHangar=false` ⇒ **立刻重新加入战斗**（复用原槽位索引与武器条目，
   与敌方"备用机库补位"同一套字段）⇒ 从**本舰货舱 → 物品仓库**扣**同型 1 架**。补完回到第 3 条。
5. **无货**：整个队列都无货 ⇒ 不启动新周期（不空转）。
6. **中断**：本舰被击毁 / 战斗结束 ⇒ 周期立即停止，**不做半格折算**。
7. **离线/后台结算**：补回架数 = `min(待补架数, floor(战斗时长 ÷ 周期))`，FIFO 尽量补，受库存封顶。
8. **战损账**：`droneLost`/`droneLostBy` 照记；战后净损失扣清单改为 `损坏 − 回收 − 战中复活`（夹在 0 以上），
   避免同一架在"复活时"与"战后 refill"各扣一次库存。战报文案单列「战中复活 V 架」。
9. **边界**：复活**只补回已损失架次、不提高编制上限**（池条目数装配时定死）。

## 接线清单（照 `docs/data-map.md` 那份漏项表逐处核对）

| 处 | 处理 |
|---|---|
| `packages/core/src/types.ts` `ModuleSlot` | **加** `'drone-deck'` |
| `packages/core/src/types.ts` `ModuleDef` | **加** `droneReviveCycleMs?: number` |
| `packages/core/src/labels.ts` `MODULE_SLOTS` / `SLOT_LABELS` / `rackOf` | **加**（`SLOT_LABELS` 是 `Record<ModuleSlot,string>` ⇒ 漏了编译就红） |
| `packages/core/src/shipWrecks.ts` `recoveryRateOfSlot` | **加** `drone-deck` → `WRECK_RECOVERY_RATE.drone`（与 `drone-rack` 同档：非武器件） |
| `packages/core/src/equipment.ts` `WEAPON_SLOTS` | **不加**（本件不是武器，与 `drone-relay` 同待遇） |
| `packages/core/src/wormholeAuto.ts` 高槽火力计数 | **不加**（同上：它不加伤害；且该处只扫 `fitted.high`） |
| `tools/content-check.ts` 字段→家族契约表 | **加** `droneReviveCycleMs: 'drone-deck'` |
| `tools/content-check.ts` V18 字段自洽 | **加** 一条取值域检查 |
| 数据 | `modules.ts` / `marketCatalog.ts` / `blueprints.ts` / `rarityTier.ts` / `l10n.ts` / `l10n/table.ts` |
| 存档 | `state.ts`（战场字段）· `save.ts`（`cleanBattle` 白名单，⚠ 触发"需裁决"钩子档） |
| 界面 | `ui/shipInfo.tsx` 参数行（**说明文案不手写数字**，甲案） |

## 接线漏项实清单（**闸门实测**，不是靠人脑列）

我按 `docs/data-map.md` 那份清单先列了 8 处，落码一跑 `typecheck` + `content:check`，
**又揪出 4 类我没预料到的**（这就是这两道闸门存在的意义）。下一轮照此一次做全：

| # | 处 | 闸门原话 |
|---|---|---|
| 1 | `apps/desktop/.../ui/labelsText.ts`（`Record<ModuleSlot,string>`） | `error TS2741: Property '"drone-deck"' is missing` |
| 2 | `apps/desktop/.../ui/shipInfo.tsx` 的 `moduleShortEffect` 分支 | ✗ 装备的**短效说明为空**——装配页卡片会一句话都没有 |
| 3 | `apps/desktop/.../ui/Glyphs.tsx` 的 `SHAPES['drone-deck']` | ✗ 图标契约：缺 Glyphs 图形（会落兜底圆环徽） |
| 4 | 同上 `TONES['drone-deck']` | ✗ 图标契约：缺 TONES 色调（未知键落默认灰） |
| 5–7 | `marketCatalog.ts` 补 `bp-drone-deck-1/2/3` 的**蓝图市场行** | ✗ 挂卖可达契约（既挂不了卖也卖不掉）· ✗ 图鉴市场跳转契约 · ✗ 蓝图价格口径（买不到、无法比对书价） |

已核对**无需改**的：`equipment.ts` 的 `WEAPON_SLOTS`（本件不是武器，与 `drone-relay` 同待遇）、
`wormholeAuto.ts` 两处高槽火力计数（同上，且那处只扫 `fitted.high`）。

## 待办

- [x] 走完 §2 四步闸门（集中提问 / 设计总结 / 显式确认）
- [x] 槽位冲突已裁决（§5.2）
- [x] 数值定案（周期 / CPU / 价格 / 蓝图材料，料价比 45%）
- [ ] **注册层**：`types.ts`（`ModuleSlot` + `droneReviveCycleMs`）· `labels.ts`（`MODULE_SLOTS` / `SLOT_LABELS` / `rackOf`）· `shipWrecks.ts`（回收档）· `labelsText.ts` · `Glyphs.tsx`（SHAPES + TONES）
- [ ] **数据层**：`modules.ts` ×3 · `marketCatalog.ts` ×3 现货 + ×3 **蓝图行** · `blueprints.ts` ×3 · `rarityTier.ts` ×3 · `l10n.ts` ×3
- [ ] **体检契约**：`tools/content-check.ts` 的"字段→家族"表补 `droneReviveCycleMs: 'drone-deck'` ＋ 取值域检查
- [ ] **机制层**：`state.ts`（`battle.droneRevive`：待补队列 / 各件到点时刻 / 已复活计数）· `combat.ts`（开战建档两处：单舰 `L5310` 与多舰 `L5673`，逐舰记 `tag → shipId`；被击落入队 `L7907`；每拍推进挂 `resolveFoeRevive` 之后 `L6919`；净损失算式 `L6523`）· **库存取用单点**（本舰货舱 → 物品仓库，与 `refillDroneLoadTo` 同顺序——需先确认货舱访问器）· `save.ts`（`cleanBattle` 白名单，⚠ 触发"需裁决"钩子档）
- [ ] **界面**：装配页卡片短效说明 ＋ 参数行「复位周期」＋ `l10n/table.ts` 新 id
- [ ] **用例**：周期时长 / 单件串行 / **按需启动（1 架损失不空转）** / 满血归队 / 同型消耗顺序 / 无货跳过 / 离线折算 / **战损账不双扣**
- [ ] 全闸门 + 提交 + 推送
- [ ] `docs/glossary.md` 新术语登记
- [ ] 归档（§8 三步）

## 2026-09-27 本轮收口说明（如实记录）

**本轮只做到"设计定案 + 数值定案 + 接线清单实测"，代码改动已全部回退**：
落码跑到 `typecheck`/`content:check` 把漏项清单逼出来之后，一号的上下文已到上限，
继续写机制层有把代码写坏的风险 ⇒ **主动停手并 `git checkout` 回退全部代码改动**，
**不留下"能买能装但引擎不认"的空模块**（那正是本仓库最忌讳的静默失效）。
工作区已复核为干净、`typecheck` 全绿。下一轮照上表一次做全即可。

