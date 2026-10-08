# 单点索引（谁有权算、谁只能读）· 2026-09-27 建

> **这份是什么**：全仓「**这件事归谁管**」的索引。接活第一步查这里——同一个数字/同一句话，
> **只许一个地方算它**，页面/工具只许调用。
>
> **为什么要有它**：船长 2026-09-27 原话（照抄）：「**现在的开发流程挺混乱的，各种代码都是地方单独调用，
> 我们能否商量下，进行开发流程规范？**」——规矩写进了 `docs/development-conventions.md`「取数与派生纪律」，
> **本文件是那张规矩的落地索引**，护栏 = `npm run arch:guard`（`tools/arch-guard.ts`）。
>
> **怎么用**：
> 1. 要动某个数值/文案/派生显示 → **先在本表找它归谁**；找到就调用，找不到就**先在本表登记**再写码。
> 2. 新增单点 ⇒ 登记 `tools/arch-guard.ts` 的 `SINGLE_SOURCE`；本文件同步补一行供人查阅。
> 3. 改名/搬家 ⇒ 机器注册表和本文件一起改；F3 目前只检查机器注册表指向的源码文件与符号，**不核对两份登记表的文字一致性**。
>
> **不一致时以代码为准**，并**当场把本表改对**；本表随单点登记同步维护。

## 一、core 引擎层（`packages/core/src`）

| 关注点 | 唯一实现 | 护栏 |
| 悬赏后台预热任务与缓存代次 | `BountyWinCache` · `game/bountyWinCache.ts`；真实评估仍为core `estimateBountyWinOn` | 单worker/每卡30局、失效取消/战斗让路、结果等价与双端真实worker响应专项 |
| 敌舰/机群/挂载/编队源数字参数读取 | `enemyParameterOf()` · `packages/core/src/enemyParameters.ts` | 六表字段契约、迁移前完整目录逐值相等及真实引擎预览专项；公式与引用留TS |
| 战斗演出跨场与读档续播 | `battleFxArrivals()` · `apps/desktop/src/renderer/src/ui/battleFxCursor.ts` | 绑定战斗对象、序号回退、陈旧事件与连续战斗专项 |
| 静态JSON参数与文本/派生绑定、数值编辑计划 | `staticDataGroup()` · `packages/data/src/staticData.ts`；`planDocuments()` · `tools/data-editor-schema.ts` | 固定基线目录等价、编辑事务与字段校验；JSON权威静态参数，公式/文本留代码 |
|---|---|---|
| 武器齐射整数扣弹与预付余额 | `battleWeaponAmmoCost()` · `combatAmmo.ts` | 半发不跨舰／组／弹种、读档不断额度、整数弹库存守恒 |
| 首次无人机出击间隔 | `droneLaunchGapMsOf()` · `droneLaunch.ts` | 每舰500毫秒、掠袭机库逐件缩短、复活重排、旧档续战；队列专项 |
| 扩槽插件同类型限制 | `plugSlotExpansionKindOf()` / `plugSlotExpansionBlockedOf()` / `normalizePlugSlotExpansions()` · `plugs.ts`；`repairSlotExpansionPlugs()` · `equipment.ts` | 中低两类分别限一件、普通重复件保留、免费退库与幂等；F2/F3 |
| 全编队武器与装置周期 | `battleWeaponCyclesOf()` · `battleWeaponView.ts`；`battleDeviceCyclesOf()` · `battleDeviceView.ts` | 实际账本只读、僚舰覆盖、同舰同型数量与实际射程、动态装填、缺料与沉没状态；F2/F3 |
| 装备负面随收益折权、抗性减法与全战斗主动周期 | `fittedPenaltyPartsOf()` / `equipmentPenaltiesOf()` / `equipmentCycleMsOf()` · `equipment.ts` | 同型/混装排序、缺口边际、正负值一致、武器与主动周期/往返专项，F2/F3 |
| 敌舰受击增程的独立挂载件触发提示 | `announceFoeGunRangeBuff()` · `foeRange.ts`；说明继续走`mountEffectText()` | 主/副目标、独立文案、中英参数及原增程判定专项；`arch:guard` F2/F3 |
| 五类准备阵容清洗、恢复与记忆 | `cleanPreparationSquads()` / `preparationSquadOf()` / `notePreparationSquad()` · `preparationSquads.ts` | 五类隔离、实例顺序、缺船/忙态、显式空、旧档兼容与往返；页面通过统一选择hook接入；`arch:guard` F2/F3 |
| 护盾力场排除自身、有效目标与最大护盾代价 | `pulseShieldFieldFor()` / `SHIELD_FIELD_COST_PCT` · `combatRepair.ts` | 力场专项：费用与目标数无关、足量/不足/无目标、周期/混装/读档；详情费用读取同一常量；`arch:guard` F2/F3 |
| 版本化星系、坐标输入、搜索周期与候选容量 | `generateStellarSystem()` / `parseStellarSeed()` · `stellarGeneration.ts`；`stellarSearchDuration()` / `stellarCapacity()` / `stellarSystemDeveloped()` / `stellarCandidateCount()` · `stellarSearch.ts`；`cleanStellarState()` · `stellarSave.ts` | 同种子独立世界、预扣／暂停／连续搜索、基地保护、超过64星球往返专项 |
| 探测机专属材料折扣 | `probeMaterialFactor()` · `probeManufacturing.ts`；由既有 `matNeedCount()` 贯穿预览、投料、续产和退款 | 百万配方、全级折扣、普通蓝图隔离专项 |
| 星系动态视口与手势 | `stellarViewBox()` / `moveStellarGesture()` · `stellarMapView.ts` | 缩放锚点、旋转逆矩阵、双指减指、逐星系会话记忆专项 |
| 星球运行、供电、工程材料与运输 | `advancePlanetary()` / `planetRuntime.ts`；`planetColonyView()` / `planetColony.ts`；`cancelPlanetJob()` / `planetConstruction.ts`；`dispatchPlanetDelivery()` / `planetLogistics.ts` | 在线离线同值、实际扣料／到货、人口保护与保存专项，F9无环 |
| 战斗逐舰推进器点火与敌舰冲锋状态 | `battleArcsFor().myUnits[].boosting` / `.foeChargingTags` · `combat.ts`；复用`buildMyUnitSpecs`、`unitSpeedMulOf` | 加速特效专项：周期、捕获网、死亡、真实冲锋、重载及视图只读；`arch:guard` F2/F3 |
| 星球注入目录参数和引用校验 | `planetCatalogIssues()` · `planetCatalog.ts` | 生成入口与内容检查共用；非法参数、冲突引用、重复相邻规则专项 |
| 星球生成、勘探、环境、四向相邻、建设校验与存档 | `generatePlanet()` · `planetGeneration.ts`；`planetEnvironmentOf()` · `planetRules.ts`；`planetSurveyView()` · `planetSurvey.ts`；`planetAdjacencyOf()` / `planetConstructionCheck()` · `planetGrid.ts`；`cleanPlanetaryState()` · `planetSave.ts` | 独立种子、未知信息隔离、互斥、相邻封顶／断电与存档往返专项；`arch:guard` F2/F3 |
| 玩家整船回收/装备保全与战损插件 | `hullRecoveryChanceOf()` / `wreckEquipmentRecoveryChanceOf()` · `shipWrecks.ts`；`shipDamageEffects()` / `rollShipDamage()` · `shipDamage.ts` | 工程技能加算、首次判定/往返不重掷、六类最终属性及普通插件隔离；旧残骸规则兼容 |
| 爆虫触发、本场腐蚀、全队孵化与巢母加速 | `triggerAcidBurst()` / `applyAlienCorrosion()` / `advanceFoeHatcheries()` / `advanceFoeAbilityClocks()` / `foeFleetSpeedMulOf()` · `alienCombat.ts` | 异形入侵专项：距离边界、伤害顺序、死亡去重、随档、有限/无限额度、多载体去重、有效时长与死亡解除；`arch:guard` F2/F3 |
| 限额慢补货：配置判据、初始化、周期进度、余额与统一核销 | `hasLimitedSupply()` / `ensureLimitedSupply()` / `advanceLimitedSupply()` / `limitedSupplyAvailable()` / `consumeLimitedSupply()` · `marketLimitedSupply.ts`；价格分档在 `market.ts:refreshLimitedSupplyBook()` | 市场限额专项、存档往返；`arch:guard` F2/F3；`content:check` 配置合法性 |
| 武器组炮数与逐炮守恒分摊 | `volleyGunCountOf()` / `volleyDamageShareOf()` · `combatVolley.ts` | 逐炮齐射专项；`arch:guard` F2/F3 |
| 黑市入口、候选资格、本地日界与下次刷新 | `blackMarketUnlocked()` / `blackMarketCandidateGoods()` / `blackMarketDayStart()` / `blackMarketNextRefresh()` · `blackMarket.ts` | `black-market-page-20261004.test.ts` · `arch:guard` F2/F3 |
| 黑市新货架组数量、锁定交付数与老货架单件兼容 | `blackMarketLotQuantity()` / `blackMarketOfferQuantity()` · `blackMarket.ts` | `black-market-drone-lots-20261006.test.ts`：四机型、总价/库存/售罄守恒、旧报价和读档 |
| 弹药可选档与设置合法性、普通市场可流通目录 | `ammoTiersOf()` · `ammoTiers.ts`；`marketTradingGoods()` · `market.ts` | MK3三系、设置/装配同源、黑市图纸渠道隔离回归 |
| 沉船快照保存方案、重复插件参考及覆盖确认 | `saveWreckFitPreset()` / `wreckFitDetailOf()` · `fitPresets.ts`；明细沿用`fitPresetDetailOf()`，插件参考不参与自动安装 | 重复插件/第九格/沉船记录读档、保存纯副作用及套用守恒回归 |
| 虫洞整备库存/容量预览、补给占格与撤离核对 | `wormholePreparationPlan()` · `wormholePreparation.ts`；`wormholeSupplyCells()` · `wormholeSupplies.ts`；`wormholeExtractionPlan()` · `wormholeExtraction.ts` | `wormhole-supplies-20261004.test.ts` / `wormhole-cargo-flow-20261004.test.ts`；`arch:guard` F2/F3 |
| 虫洞当前地点实物格板（不建立免费随行空间） | `wormholeGroundBoard()` · `wormholeGround.ts` | `wormhole-cargo-flow-20261004.test.ts`：地点隔离、往返不复制、深入确认与数量守恒 |
| 虫洞现役机群数量；旧一套备用辅助仅留核心回归、无界面入口 | `wormholePreparationPlan().deployedDrones` / `wormholePreparationFillPlan()` · `wormholePreparation.ts` | `wormhole-supplies-20261004.test.ts`：四舰、混合机型、缺货、超容、预览不扣货；`arch:guard` F2/F3 |
| 虫洞多模板保存/清洗与按模板补齐（总量包含已有货，含明确0） | `cleanWormholePreparationTemplates()` / `wormholeTemplateFillPlan()` · `wormholePreparationTemplates.ts` | `wormhole-preparation-templates-20261006.test.ts` / `wormhole-expedition-ui-20261004.test.ts`：缺货、超容、已有货超目标、卸港、保存往返 |
| 旧信号空间与未来虫洞命名、历史文本保留 | `signalSpaceTextId()` · `explorationText.ts`；客户端`futureWormholeEnabled()` · `debugFlag.ts` | `signal-space-identity-20261006.test.ts`：旧坐标/新实验标记/历史日志/明确门禁；新日志写入时锁定ID，不重写存档历史 |
| 虫洞第二批事件费用/后果、出发补给包与有限巡逻 | `wormholeEventPreview()` · `wormholeExpedition.ts`；`wormholeSupplyPackageOf()` · `wormholePreparation.ts`；`wormholePatrolAfterAction()` · `wormholePatrol.ts` | 仅显式新规则测试趟；一次性、费用、警戒名额与存档往返用例；`arch:guard` F2/F3 |
| 虫洞新规则实际敌方血/火力预算与机制编成 | `wormholeExpeditionCard()` · `wormholeExpeditionFoes.ts` | 独立副本卡、不改变共用舰级；实际属性反推显示威胁；开战/续战/视图同源；新规则敌人用例及十层工具 |
| 虫洞自动新模式与十层工具的真实决策策略 | `wormholeRunExpeditionPolicy()` · `wormholeExpeditionPolicy.ts` | 只读已揭露信息、逐拍真实战斗、不补料不跳层；独立模拟状态，限定回写结果 |
| 虫洞已知守卫战前只读风险预估 | `wormholeGuardRiskPreview()` · `wormholeExpeditionPolicy.ts` | 三份固定独立随机副本、真战斗引擎和有限物资；不改真实账，必须交火时不提供脱离 |
| 虫洞事件/警戒/已揭露敌情展示 | `wormholeEventView()` / `wormholeAlertView()` / `wormholeEncounterView()` · `wormholeExpeditionView.ts` | 费用与后果复用事务预览；敌卡复用战斗派生；未知地点不泄露情报 |
| 纯货舰模块能力兼容（安装/换装/候选/建档/修复同源） | `moduleAllowedOnShip()` · `shipFitting.ts` | `hauler-balance-20261004.test.ts`；`arch:guard` F2/F3 |
| 入侵残骸每族余额/箱子读数与旧账迁移 | `weekendWreckPoolsOf()` · `salvage.ts`；`normalizeWeekendWreckRecord()` · `weekendWreckLedger.ts` | `invasion-ledger-20261003.test.ts`：多族守恒、迁移、独立衰减与满舱不丢货 |
| 聚焦阵列波内射程/防空加算修正率 | `coronaFocusBonusOf()` · `coronaFocus.ts` | `corona-balance-20261003.test.ts`：时点/换波/加算抵消/真实近防入口 |
| 聚焦阵列全队射程与来源存活 | `coronaFleetRangeBonusOf()` · `coronaFocus.ts` | `corona-reinforcement-20261008.test.ts`：同进度/新支援/死亡失效/多源取最高 |
| 固定支援舰真实型号标识 | `supportFoeModelTagOf()` · `foeCard.ts` | `corona-reinforcement-20261008.test.ts`：型号/空槽分离、名称/舰影/规格同源 |
| 技能取消的"连带失效"基线（只报/只删因本次取消才失效的项） | `preexistingUnmet()` · `skillQueue.ts` | core 用例 `skill-cancel-baseline-20260926.test.ts` |
| 存档清洗白名单（新增随档字段必须"写入点 ＋ 白名单"两处落笔） | `normalizeState()` · `save.ts` | `packages/core/tests/save.test.ts` 类型穷尽 ＋ `save:roundtrip-audit` |
| 伤害类型配色（动能/爆破/能量 同族同色） | 伤害配色契约（token 单点） | `npm run ui:theme-check` 的 `dmg-color-check` |
| 装备归属档（高/中/低/**舰船插件**四档） | `rackDimKeyOf()`（渲染层）＋ core `rackOf` | `content:check` 归属档契约 |
| 回收/打捞产出与价值读数 | core `industry.ts` / `salvaging.ts` 的产出单点 | `npm run salvage:econ` · `recycle:compare` |
| 矿带每小时产出与**行情产值**（排序档「行情产值最高」与矿带卡面共用） | `beltYieldRows()` / `beltValuePerHour()` · `mining.ts`（**2026-09-30 建**：原先渲染层写了两份，排序那份还停在基准价口径 ⇒ 船长报障「原矿价值最高的排序已经落后」） | core 用例 `belt-sort-value-20260930.test.ts` · `arch:guard` F2/F3 |
| 手动工作位被谁占着（精炼炉/回收炉/拆解台/制造线/实验室共用的那一个名额；AI 核心驱动不算） | `manualSlotOf()` · `activityGate.ts`（**2026-10-01 建**：船长令「新的工业 UI 要改成和旧的工业一样，主控正在活动时禁止按钮」⇒ 界面得先问出"被谁占着"；原先这条判据在 `lab.ts`/`industry.ts`/`manufacturing.ts` 各写一份） | core 用例 `activity-lab-20261001.test.ts` 的「手动工作位判定」组 · `arch:guard` F2/F3 |

## 二、data 表面（`packages/data/src`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 仿真上下文（页面取数的唯一入口） | `buildSimContext()` · `context.ts` | `arch:guard` F1/F4 |
| 玩家可见文案唯一表（`id → { zh, en }`） | `L10N` · `l10n/table.ts` | `npm run l10n:check` ＋ `l10n:list` |
| 已登记待译条目的中文回退 | `l10nEntryText()` · `l10n/table.ts`；界面`textOf`及主进程`t`调用 | 待译标记/文档登记成对、非待译空值仍拒绝、同入口占位符与中英渲染专项 |
| 内容名/说明的英文覆盖层 | `packages/data/src/l10n.ts`（`EN_*` ＋ `overlay*`） | `l10n:check` ＋ core `l10n-overlay.test.ts` |
| 势力族色 | `FOE_ACCENT` · `ui/tones.ts` | 与星图族标签/战场敌舰/图鉴族徽同源（人工核） |
| 物品稀有度分档 | `itemRarityTierOf()` · `rarityTier.ts` | `content:check` 稀有度契约 |
| 公告数据（**仅经船长批准后写入**） | `announcements.ts` | 约定 §十二（发布审核） |

## 三、渲染表现层（`apps/desktop/src/renderer/src`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 两个市场入口的商品名称与蓝图产物/材料悬停 | `marketGoodDisplayName()` / `blueprintHoverLines()` / `MarketGoodHover` · `ui/marketGoodHover.tsx` | `arch:guard` F2/F3；黑市浏览器专项 |
| 市场商品卡图标/分类/说明及完整详情 | `marketGoodInfo()` · `ui/marketGoodHover.tsx`；参数沿用仓库信息行，黑市场景不含参考价 | `arch:guard` F2/F3；黑市卡片详情回归 |
| 网页重连存档摘要与有效状态内容比较 | `reconnectProgress()` / `sameReconnectProgress()` · `game/saveReconnect.ts` | `save-reconnect-engine-20261004.test.ts` · `arch:guard` F2/F3 |
| 物品领域分类与未知条目兜底 | `itemCategoryOf()` · `ui/itemSubs.ts` | 筛选专项测试 · `arch:guard` F2/F3 |
| 市场领域与细分判定 | `marketDomainPasses()` · `ui/itemSubs.ts` | 筛选专项测试 · `arch:guard` F2/F3 |
| 引擎与 `ctx` 的产地（页面取数都从它来） | `GameEngine` · `game/engine.ts` | `arch:guard` F1/F4 |
| 标签取词（槽类/槽位/舰级/地点/机型/物品大类…） | `labelsText.ts`（`kindText` 一族） | `ui:subs-check` 的「本地化直读契约」 |
| 族徽判据收窄（判"有没有族"只走它）＋ 族徽可读名（`aria-label` 取势力全称） | `crestFamOf()` / `crestLabelOf()` · `ui/labelsText.ts`（**2026-09-27 从 `panels/Handbook.tsx` 迁出**：图鉴 `IconGrid` 与物品页仓库/货仓的 `ItemGlyphGrid` 共用一份） | `ui:attr-check` 的「族徽判据契约」（改查单点文件 ＋ 两处网格的 `!= null` 兜底） |
| 图鉴卡片构造（装备/舰船/物品/蓝图/势力同源） | `itemCellOf()` 等共用 builder · `panels/handbookDetail.tsx`（**2026-10-02 从 `panels/Handbook.tsx` 拆出**） | `ui:attr-check` ＋ `arch:guard` F2 |
| 取色跨表兜底 | `toneOfAny()` · `ui/tones.ts` | 人工核（约定 §九） |
| 悬停提示接管层（全站唯一延迟 500ms 与"内层优先"） | `ui/Tooltip.tsx`（`TIP_DELAY_MS`） | `ui:tip-check` ＋ `ui:rot-check` |
| 悬停富卡皮肤（模块/物品/舰船参数表） | `ui/shipInfo.tsx`（`infoCardContent` 一族） | 约定 §九之七（人工核） |
| 视口懒挂载（大列表流式加载） | `ui/LazyMount.tsx` | `industry:lag` 读数 ＋ 人工核 |
| 活动栏「停止/取消」按钮文案（新版与旧版两套外壳共用） | `panels/activityStopLabel.ts` 的 `stopLabel()` | `arch:guard` F2（2026-09-27 收口 A1：原先两份逐字相同） |
| 活动栏行「点击去哪」的跳转表（两套外壳共用） | `ui/activityGo.ts` 的 `goFor()` | `arch:guard` **F5 跳转目标契约**（2026-09-27 建：原先两份重复，快递那档跳到已删除的星图页签 ⇒ **空白页**） |
| 入侵循环下一目标与实际抽卡冷却（在线/离线与活动栏同源） | `autoLoopInvasionPlanOf()` · `core/expedition.ts` | 入侵路线专项：外围顺序、核心后置、只读抽签、等待与进度一致；`arch:guard` F2/F3 |
| 属性表拼装（装配页/图鉴/蓝图产物/舰队悬停四处） | `ui/shipInfo.tsx` 的行工厂 | `ui:attr-check` 的「同名两行」体检 |

## 四、工具与文档层（`tools/` · `docs/`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 正式工具与临时探针的区分与收尾 | 约定 §十（`tools/xxx.ts` vs `tools/_*.ts`） | `npm run tools:audit` |
| 提交钩子B类审批范围与暂存内容绑定 | `tools/git-gate-approval.cjs`；本工作树Git目录审批记录，`.githooks/pre-commit` / `post-commit`调用 | `git-gate-approval-20261004.test.ts`：精确批准、变更失效、技术失败拒绝与成功消费 |
| 文档索引（全仓清册） | `docs/INDEX.md`（仅由 `npm run docs:index` 生成） | `docs:index --check` |
| roadmap 滚动窗口与封存卷 | `npm run docs:seal` | 工具自带守恒校验 |
| 工作文档 → 归档三步 | 约定 §十五 | 人工核（本批列出） |
| 本索引自身与护栏注册表的同步关系 | 本文件（人读索引）＋ `tools/arch-guard.ts` 的 `SINGLE_SOURCE`（机器执行源） | `arch:guard` F3 只核对机器执行源的源码落点；两份文字表同步由人工维护 |

## 五、维护纪律（三条）

1. **新派生值先登记再写码**：先在 `tools/arch-guard.ts` 的 `SINGLE_SOURCE` 加一项，再在本表补一行 ⇒ 再去写实现；`arch:guard` F2 会对"已登记单点被别处再写一份"报红。
2. **护栏栏写不出东西的条目** ⇒ 标 🟡「待补护栏」，不许假装已经上锁（人工核也是护栏，但要写明"人工核"）。
3. **本表与代码不一致时以代码为准**，当场改本表；改完跑 `npm run arch:guard` 复核（F3 会挡住悬空条目）。

---

_建表：2026-09-27（三号 · verify）· 首批条目取自 2026-09-24~27 各批归档结论与本次全仓取证；_
_条目增删随代码走；规则变更仍按开发约定的工作文档与归档流程处理。_
