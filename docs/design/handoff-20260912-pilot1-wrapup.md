# 续接卡 · 一号批次收尾归档（2026-09-12 · 一号 main）

> 用途：把一号在 2026-09-11 ~ 09-12 交付的**全部批次**固化成交接件——状态、读数、待船长项、关键落点与踩坑。
> 与二号/三号各自的续接卡（`handoff-20260912-foe-overhaul-wrapup.md` 等）并列；**术语以 `docs/glossary.md` 为准**，
> 批次细节以 `docs/roadmap.md` 变更记录为准（本卡只做索引与状态）。

## 一、当前状态

- **主树 `main` = `origin/main`**（已推送，无待推送提交）；二号工作区 `d2/workspace` 与主树同点；
  三号工作区 `verify` 落后主树 129 个提交、无独有提交（只读观察，未动）。
- **三树全部干净**：`git status --porcelain` 空、`git stash` 0 条、`_` 前缀临时探针 **0 个**（含 `tools/` 与全树扫描）。
- **验证快照**（本次收尾复跑）：typecheck 四包全绿 · core **998/998**（98 文件）· `content:check` 全绿 ·
  桌面与网页版 build 全绿 · `npm run balance` / `bounty:econ` / `faction:audit` / `manufacture:econ` 可跑通。
- **公告状态**：已发布 27 条（最新 `2026-09-12-foe-overhaul`、`2026-09-11-comms`）；
  一号 09-11~09-12 批次**尚无公告**——待审稿已出：`docs/design/announcement-draft-20260912-pilot1-batches.md`（8 张卡，待船长审核）。

## 二、本轮交付（按线 · 状态均为已推送）

| # | 批次（对应 roadmap 条目） | 要点 | 主要提交 |
|---|---|---|---|
| ① | **船体维修装置日志收口** | 取消开战「待命/缺料」与「组件耗尽」两条日志；消耗数只进战后总结（`，船体维修装置消耗 军用修理组件 ×12`，五处战报同源 `repairUsageText`） | `9a58edd` |
| ② | **蓝图价全表统一** | 书价 = 产物现货价 × 档位系数（民用/基础/MK1 ×2 · MK2 ×2.5 · MK3 ×3 · 奇货 ×4，取整 500）；**弹药线维持原值**（覆盖表 6 条）；舰船蓝图维持船价档位带；`content-check` 新增「蓝图价格口径」契约（硬：两处同值；预警：偏离系数、料/价出带） | `4256507` `8497f6b` `37a8483` `1116a45` |
| ③ | **低槽「协处理器」** | 新族 `slot='cpu'`（+25/+35/+45，本件不占 CPU）；双向校验堵「装卸偷 CPU」；`swapModuleAt` 原子换装 | `4e225fb`（含数值上调） |
| ④ | **稀有残骸保底** | 派系活跃掷骰链连刷 **19 次未出 → 第 20 次必掉**（`FACTION_RARE_DROP_PITY_ROLLS`，实际率 5% → ≈7.8%/趟） | `3327957` |
| ⑤ | **回收残骸日志/卡面** | 炉所得明细改显示装备**中文名**（修 `mod-lair-turret-a` 裸 id）；卡面删「必定/每炉必给一件」保底措辞，只留掉落列表 | `7a25a8a` |
| ⑥ | **目标距离按星系保存** | `desirePrefByGalaxy`（每星系独立、随档保留）；**实战与胜率预估都按该星系设定**，没设过回落射程中段；AI 副船不吃（只有主控） | `43a3281` `bad5413` |
| ⑦ | **手动撤退 = 立刻回港** | 手动撤退不再付返航航程（自动撤退与超时判负仍返航）；撤退承伤按敌方火力先扣装甲（K = 1 秒，三档同一 K） | `bad5413` |
| ⑧ | **市场砸盘机制** | 每层冲击 **−10%**；**砸得越狠收购单量 +8%/层**（全部商品）、**挂卖单量 −8%/层**（下限 10%）；池商品**收购量摘掉库存压力**（价格仍保留压力）；价格下限 **0.1×** | `5872b62` `66d888e` |
| ⑨ | **市场其余** | 挂买单改 **EVE 式预扣冻结**（撤单退回、旧档零迁移）；市价买入失败四类原因分诊 + 按钮门控；「消耗品」独立成一级类型 | 见 roadmap（09-11 三条） |
| ⑩ | **界面改造** | 我的舰队：移除排序、级别 + 类别三级筛选、搜索入标题行；组装机蓝图二级子筛选（产物功能九组 / 舰船按级别）+「弹药蓝图」→「消耗品蓝图」；换装卡补弹伤倍率与层位克制；战斗界面敌方射程逐带显示；教程跳转两处修正；通讯器下檐口按钮常驻 | 见 roadmap（09-11 六条） |
| ⑪ | **数值/经济其余** | 舰船售价与图纸价对齐（+ 价格预警）；长途运输航时 ×15 / 每趟 5~10 倍行情波动（面板只显示区间）；推进器周期口径写进说明；低安遇袭重做（受损按敌火 + 装甲先吃 + 结构 <50% 撤退） | 见 roadmap（09-11 四条） |

## 三、接手必读口径（易踩）

1. **蓝图价**：单点 `data/blueprints.ts` 的 `blueprintTierCoefOf(bpId, rarity)` / `blueprintBookPriceOf`；**`rarity` 必填**
   （漏传会把奇货算成 MK 档）；个例走 `BLUEPRINT_PRICE_OVERRIDES`（现 6 条弹药线）。两处价必须同值（硬契约）。
2. **目标距离**：单点 `combat.desirePrefOf / setDesirePrefOf`；写入方 = 战斗中拖条（本场星系）/出发 `opts.desireM`（目标星系）；
   读取方 = 实战开战 + MC 预估快照 + 稳态解析；`desireM = null` 表示"强制射程中段"（AI 副船专用）。
3. **市场砸盘**：`dumpBuyVolumeMul` / `dumpSellVolumeMul`（层数 = `|shock| ÷ shockPerTrigger`，**不取整**，只在 `shock < 0` 生效）；
   池商品收购阶梯量**不含** `pClamped`，价格**含**。改 `shockPerTrigger` 会同时改变"每层幅度"与层数口径。
4. **稀有残骸保底**：`rareWreckDryStreak` 随档；**任何稀有残骸入库都清零**（`salvage.injectRareWreck` 单点）。
5. **撤退**：`settleBattleRetreat(mode)` 三档——`manual` 零航程、`auto`/`timeout` 仍返航；承伤口径与低安遇袭共用 `hullDamage.ts`。

## 四、未决 / 待船长项

| # | 事项 | 现状 |
|---|---|---|
| 1 | **公告审核** | 待审稿 8 张卡（`announcement-draft-20260912-pilot1-batches.md`）待批；批准后由经办人写入 `announcements.ts` |
| 2 | 非派系活跃星系仍无稀有残骸保底 | 按船长裁决「口径甲：只保底派系活跃那条掷骰链」；若要扩到所有星系/中安低安，一句话即改 |
| 3 | 协处理器价格未随 CPU 上调 | 船长只点名 CPU 数值；若要让三档"单位成本"齐平，只需上调 MK1 或下调 MK3 |
| 4 | 战斗界面未显示「本星系目标距离」 | 船长已裁「不用更改」（保持现状） |
| 5 | 稀有残骸卡面不列蓝图碎片 | 船长已裁「维持现状」（引擎对稀有残骸照常掷碎片） |

## 五、关键落点（本次相关）

- core：`combat.ts`（`desirePrefOf` / `setDesirePrefOf` / startBattleFor 距离解析 / `steadyPreview` / `repairUsageText`）、
  `equipment.ts`（`cpuBudgetOf` / `cpuOverloadText` / `swapModuleAt`）、`market.ts`（`dumpBuyVolumeMul` / `dumpSellVolumeMul` /
  `priceLevel` / `refreshGoodOrders`）、`lairs.ts`（`FACTION_RARE_DROP_PITY_ROLLS` / `factionRareDropEffectiveRate`）、
  `salvage.ts`（`injectRareWreck` 清零）、`expedition.ts`（撤退/开战/目标距离）、`winEstimate.ts`（预估快照带距离表）、`save.ts`（两处归一化）。
- data：`blueprints.ts`（`blueprintTierCoefOf` / `BLUEPRINT_PRICE_OVERRIDES`）、`balance.ts`（`shockPerTrigger` /
  `dumpBuyVolumePerLayer` / `dumpSellVolumePerLayer` / `minPriceRatio`）、`modules.ts`（`mod-cpu-*`）。
- 测试：`cpu-coprocessor` / `market-buy-escrow` / `market-buy-reason` / `market-dump-penalty` / `rare-wreck-pity` /
  `desire-per-galaxy` / `retreat` / `recycle-log-names` + `market.test.ts`、`expedition.test.ts` 口径同步。
- 文档：`docs/glossary.md`（协处理器 / 蓝图价格口径 / 冲击动量 / 目标距离 / 船体维修装置 / 敌对派系活跃掉落概率 等条目）、
  `docs/design/v9-market.md` §二、`docs/design/hull-repair-module-20260909.md` §八、`docs/design/t8-galaxy-stay.md`、`docs/roadmap.md` 变更记录。

## 六、本次收尾做的两件事

1. **roadmap 去重**（合并残留）：`docs/roadmap.md` 曾有**两个「变更记录」段**、跨段重复 22 条（整行完全一致）。
   已合并为一段（24 + 117 = **141 条**，每条唯一），**纯删除 23 行（1 个多余表头 + 22 条重复副本）、0 行新增、0 内容丢失**；
   自检三条全过（BOM 无/口径一致 · 行尾 CRLF 不变 · 全树往返解码乱码 0）。
2. **三树盘点**：main / d2 / verify 全部干净、无 `_` 探针、无未提交改动、无 stash（见 §一）。
