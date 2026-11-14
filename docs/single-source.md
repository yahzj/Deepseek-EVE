# 单点索引（谁有权算、谁只能读）

> **这份是什么**：全仓「**这件事归谁管**」的索引。接活第一步查这里——同一个数字/同一句话，
> **只许一个地方算它**，页面/工具只许调用。
>
> 原因：页面与工具复用规则所有者，避免重复计算；护栏为`npm run arch:guard`。过程记录已封存，未经船长明确要求禁止读取旧记录。
>
> **怎么用**：
> 1. 要动某个数值/文案/派生显示 → **先在本表找它归谁**；找到就调用，找不到就**先在本表登记**再写码。
> 2. 新增单点 ⇒ 登记 `tools/arch-guard.ts` 的 `SINGLE_SOURCE`；本文件同步补一行供人查阅。
> 3. 改名/搬家 ⇒ 机器注册表和本文件一起改；F3 目前只检查机器注册表指向的源码文件与符号，**不核对两份登记表的文字一致性**。
>
> **不一致时以代码为准**，并**当场把本表改对**；本表随单点登记同步维护。

## 一、core 引擎层（`packages/core/src`）

工业遇袭风险归`encounters/risk.ts`：`industrialFleetSnapshotOf`只取真实出勤质量与携货，`industrialThreatOf`以活动参数档输出目标威胁，`industrialFrequencyOf`独立计算提频/护航修正；集中默认值在`encounters/config.ts`并由`DEFAULT_BALANCE.encounter.industrial`注入。普通海盗配置只由`encounters/pirateFormation.ts:pirateFormationOf`按目标威胁和种子生成，不读取活动和玩家战力重复加成。全队运输容量与比例装载归`hauling/load.ts:haulFleetLoadOf`。

普通海盗生成第2版在同一预算内逐波填舰，最多3波、每波12舰，剩余预算允许固定HP/伤害最多2倍增幅；整场强度仍由`foeStrengthOf`与同一定价口径反算，不将各波威胁直接相加。倍率与完整逐舰规格随快照保存，旧单波场次不重抽；特种舰额度按整场计。

运输风险预览归`hauling/preview.ts:haulRiskPreviewOf`，按冻结航路同口径位置调用工业风险单点，不消费随机数。运输航线及费率归`hauling/routes.ts`，`hauling.ts`只保留公共命令和旧在途单段兼容，避免推进与费率模块互相依赖。

敌卡固定规格扩编归`combat/formation.ts:enemyFormationCard`，从旧卡逐波实战规格增加单位并相对重标威胁；建档统一走`combat/foes/formation.ts:fixedFormationSpecs`，新增人数不重算多舰补偿，保留强度与旗舰血池覆写。规则版本随战斗持久化，旧战斗继续旧编成。

射程电子战归`combat/rangeEw.ts`：`rangeEwBaseOf`按舰级取基础，`playerRangeEwOf`按实际名单取船体/装备贡献，`rangeEwContestOf`先抵消强度再调`rangeEwCutOf`换算。目标只读预览归`combat/rangeEwPreview.ts:rangeEwPreviewOf`；战内与战外共用贡献和曲线，不在界面另算。

在途敌卡由`combat/cards.ts:resolvedBattleAnomaly`按战斗版本、窝点、派系活跃、强度覆写及信号用途统一解析，推进、视图和选距共用。

训练许可购买声望归`skills/license.ts:skillLicenseStandingBlock`：购买命令、技能详情及目录列表共用累计协会声望检查；技能定义可选显式价格与声望门槛，既有rank默认定价和已购/已练豁免保留。价格仍由同文件`skillLicensePriceOf`提供，不能在页面另判免许可。

统一指挥预算：`combat/command/rules.ts`的`commandCapacityOf`、`shipCommandCostOf`、`commandBudgetOf`分别负责容量、船型成本和入口校验；常驻战斗名单归`combat/command/roster.ts:combatRosterOf`，出勤快照清洗归同域。旧4舰规则只经独立配置恢复，不另抄预算算法。

旧档编队技能补偿归`combat/command/compensation.ts:applyLegacyCommandCompensation`：仅当前可读且缺少`skills.commandCompensationVersion`的存档，在首次载入时按累计协会声望40/60/80/100补至编队协同指挥1/2/3/4级。新档直接登记已处理；已有更高等级不降级，不改声望或额外赠送前置技能。护栏为补偿与存档往返专项。

每日赏金：`expedition/bountyBoard.ts:rollBountyBoard`统一候选、分区席位、地图上限与三档匹配；`bountyTaskStandingGain`提供完成和收益展示共用的分档声望。护栏为赏金生成/结算专项及F2/F3检查。

`lab.ts:labOutputCapped`按产物聚合有效线锁定的`batchUnits`，起线、续做与燃料供应读数共用；交付按真实余量整批入库，仓满保留原线/退款账与`deliveryBlocked`随档标记。`market/constants.ts:PRICE_HISTORY_LIMIT`为行情采样和存档清洗共用窗口常量，不导入运行层。护栏为国庆专项及F2/F3检查。

双语时长分解归 `time.ts:durationParts`；方案/残骸/沉船记录槽位净化归 `save.ts:cleanRack`；手动与自动探索回合预算归 `wormhole/fleet/admission.ts:wormholeTurnBudget`。

编队实体出勤锁归`combat/command/locks.ts:commandShipDeployed`，随行舰预检归同文件`combatEscortBlock`；敌方在场空位归`combat/foes/capacity.ts:enemyFleetRoom`；逐弹药ID退款归`combat/combatAmmo.ts:refundBattleAmmo`。
远征返航换驾驶交接归`combat/command/return.ts:detachExpeditionReturn`：以旧主舰的剩余返航账为准，给存活僚舰建立独立同进度返航记录后释放远征槽；换驾驶、旧档出击和推进兼容共用，不提前卸货或重发战果。

采矿/打捞自动与停止返航卸货归`inventory.ts:unloadWorkFleetToWarehouse`：按实际随行快照逐舰分流入库，不读准备名单；无快照旧档只卸主舰。换驾驶时由`combat/command/return.ts:detachWorkReturn`将旧队转为现有逐舰返航账本，到港才卸货，不被新主控的活动快照覆盖。
实际作业名单及全队返航腿归`workFleet.ts:workFleetShipIds/workFleetReturnMs`，仅预览读取准备名单；逐舰采集参数仍归`getMiningParams`，采集效率总量归`beltYieldRows`；全队实际打捞设备周期归`salvaging.ts:salvageFleetCyclesOf`，沿用`salvagerCyclesOf`逐舰计算，不复制主驾装配。
实际随行名单由`combat/command/locks.ts:deployedCombatEscorts`读取出发快照；旧在途无快照时不补入基地舰船。
遭遇战开战与缺弹预警均调用同文件`encounterCombatRosterOf`，不拿基地意向名单代替实际随行舰。

双布局偏好归 `ui/layoutPreference.ts:readLayoutPref` 与同文件存储键；双活动栏停止命令归 `panels/activityStopLabel.ts:doStop`。新旧探索纯表现辅助归 `panels/explorationShared.tsx` 的 `holdTone`、`hexRingOf`、`explorationNumber`、`useCountUp`、`grabOffsetOf`、`WhGlyph`、`WhNebulaGlyph`；事件闭包、扫描和新旧玩法规则仍由各面板维护。以上登记 F2/F3，并以清理等价性专项核对旧实现。

最终整数数量：`ceilFinalQuantity`（`quantity.ts`）统一向上取整，只在最终HP/单发/离散脉冲/产物/材料/收支/报价落地时调用；比例、倍率、持续累计、可装上限和分摊余数不调用。极小浮点整数邻域归一由单点处理；专项保护真实小数与守恒。

抗性后实伤：`combat/combatMath.ts:applyDamageExact`保留混伤、附伤及跨层中间精度，`finalizeHitDamage`对单次命中总实伤向上取整且不超剩余血量；`applyDamage`为单系入口，`applyFoeShot`和`applyFoeUnitDamage`统一合并分量。玩家承伤仍先遵守80%齐射上限、损管保底后记账；持续恢复不取整。普通自动探索产出与稀有堆在生成末端取整，AI富矿最终装舱按可装整件封顶，原概率、搬运及在途冻结收益不重算。

信号空间层深额外资源堆数：`signalSpaceResourcePileBonus`（`wormholeFoes.ts`）；矿脉、墓场普通残骸及自动探索共用，新虫洞实验规则不增加；稀有判定只读基础堆数。

信号发射器：`invasionBeaconTypeOf`（`consumables.ts`）认物品与固定势力；`availableInvasionBeacons`从同表筛选有库存选项。使用命令、物品按钮与星图下拉共用，不在页面另造势力映射；护栏为专属发射器专项与F2/F3。

目标舰操作：`shipActuallyDocked` / `shipOperationBlockReason`（`shipActionPolicy.ts`）纯状态派生真实停靠与配置许可；远程管理不读主控忙态，船上物资只在目标舰停靠时可取。选船、装备/插件/无人机换装及`ships/fitting/ammo.ts:setAmmoTier`均读取该配置许可，不能只禁用页面而放行命令。`stationActivityStartBlockReason`（`location.ts`）只读预检现有切换再检查基地；页面不自算野外置灰。工业原料由`industryAvailable`（`industry/refining/params.ts`）提供同源可取量。护栏：停靠统一专项、失败资源守恒与页面同源检查，F2/F3/F9。

玩家手动卸货：`unloadShipCargo`（`inventory.ts`）检查目标舰货仓许可后逐项分流入库；`unloadCargoToWarehouse`只转发当前舰。`unloadCargoOfShipToWarehouse`保留为自动到港和其他已校验内部结算，界面不直接调用。

换驾驶：`changeShipBlockReason`（`shipyard.ts`）只读当前舰与目标舰状态，保留采矿、打捞、远征返航和AI召回例外；舰船页、自动探索主控交接与`changeShip`共用，拒绝时不先停运或清仓。

停工位置预检：`stationActivityStartState`（`location.ts`）浅投影现有运输、巡逻、交付的即时停工落点及采矿/打捞真实返航后的基地；站内活动门禁和航路前置共用，不退款、不改原档、不缩短返航。

站内活动返航接续：`queueStationActivity` / `stationActivityWaitsForReturn` / `cleanPendingStationActivity`（`stationActivityPending.ts`）登记单条主控待办、等待与白名单；到港执行由`engine.advanceGame`复用真实启动命令，时间推进按待办舰真实返航边界切分，显式取消不取消返航。新主控指令经`activityGate`清待办，远程操作不清。

待启动活动显示：`pendingStationActivityView`（`stationActivityPending.ts`）读取同一待办和实际返航账本，目标/进度/剩余时长/取消动作供两套活动栏共用；不把排队当作已经开工。

主控离港与星门阶段：`departure.ts:departureView` 统一活动栏的阶段、倒计时与进度；新行程离港 5 秒，星门按既有最短航程公式计算 2.5 至 10 秒但暂不启用。读档保留已登记行程的原阶段时长与进度，避免与所属活动到达时刻脱节；作业推进消费等待，不影响 AI 独立任务。

生产研究所：独立地点/信号`research`；`wormholeGrid.ts:wormholeMakeGrid`在第8层起以每层40%概率生成，最多一处、无保底；`wormholeSalvage.ts:wormholeResearchBox`使用整趟势力与独立随机流，50%本势力安全柜、50%本势力加密柜。研究所作业单独结算，不生成遗迹残骸、核心或收尾战；完成记`grid.activated`，旧`ruins+researchLab`及已领记录由存档清洗迁移。加密柜不加入普通货柜池。`encryptedContainer.ts:encryptedBlueprintGroups`为五族首批插件/武器/舰船一次性图纸显式登记与校验单点，`encryptedBlueprintDraw`统一1至3张、类别等权及允许重复抽取。
出发等待总长由同文件 `departureDurationMs` 计算，活动入口和悬赏收益估算共用；星门仅用于悬赏、采矿、打捞。

交付安排空间：`siteDeliverFreeCargoM3`（`location.ts`）只读当前可用空间，采矿/打捞待返航时按到港自动卸货后的容量预检；页面和实际安排同源，不提前卸货。

接续返航落点：`stationActivityReturnSite`（`location.ts`）沿用采矿最近基地/打捞母港航程判据，仅用于接续预检及待办舰真实到港后位置更新，不提前停靠。


| 关注点 | 唯一实现 | 护栏 |
| 货柜拆解本次启动批次产物记录 | `UnboxSessionLedger` · `apps/desktop/src/renderer/src/game/unboxLedger.ts`；结算结果取`advanceRefining`实际入库回调 | 仅渲染进程内存、成功开工清旧批、切页与库存归零保留、换档隔离、关闭重启不恢复；结果与实得数量守恒专项 |
| 装配靶场 | `createFittingRange` / `advanceFittingRange` / `fittingRangeStats` · `fittingRange.ts` | 独立state/资源，真实战斗固定距离与层，原状态逐键守恒及实际伤害统计专项 |
| 星球已开发标记 | `stellarPlanetDeveloped` · `stellarSearch.ts`；星系状态仍由`stellarSystemDeveloped`读取 | 已建成基地才标记，准备殖民状态不误报；星系容量原行为守恒专项 |
| 星系星图与选中目标外形 | `StellarPlanetArt` · `ui/stellarArt.tsx` | 只读公开kind、七类外形复用，不能依据隐藏资源；星图几何/焦点与功能专项 |
| 星系天体本体投影清晰度 | `stellarTextureSize` · `ui/stellarPlanetShader.ts` | 地图/详情共用，带环独立尺度/上限/同帧缓存专项；材质层来自`stellarPixelMaterials`原生生成参数 |
| 星图公开地表面积与本体半径 | `stellarMapBodyRadii` · `panels/stellarBodySize.ts` | 地表总格数平方根、固态统一拥挤比例；动态/静态/命中/标签共用，气态及详情尺寸不变；面积与同步专项 |
| 手册新入侵装备与无人机显示顺序 | `handbookContentOrderOf()` · `ui/handbookOrder.ts` | 只变视图，原条目顺序与目录守恒，图标/列表/势力入口统一专项；F2/F3 |
| 酸蚀有效抗性与装备速度 | `acidResistsOf()` / `battleSpeedBonusOf()` / `foeAcidRowsOf()` · `alienEquipment.ts` | 逐层到期、触底恢复、跨波/读档；有效速度件同池折权，仅推进器受点火周期及停机影响，其他槽位持续生效，渐增件按战斗时钟增长；F2/F3 |
| 激光校准远端威力保留 | `laserFalloffOf` · `equipment.ts`，只在玩家激光建档消费 | 混装折权加算、上限1、其他武器不变专项；`arch:guard` F2/F3 |
| 敌方族格最终血量倍率 | `foeFamilyHpMulOf()` · `foePower.ts` | C族三层最终+30%、非C不变、舰体/机型独立判定、共享旗舰绝对血覆盖与预算不抵消专项 |
| 全舰容量提升及敌舰最终倍率 | `SHIP_HP_UPLIFT_MUL` · `combatMath.ts`；`foeShipHpMulOf()` · `foePower.ts` | 玩家舰体/插件1.5、敌舰最终1.5且保留族格、预算和火力不变、无人机排除、共享池绝对覆盖专项 |
| 守墓装备危机倍率、动态规格与磁轨射后叠层 | `crisisEffectsOf()` / `playerGravekeeperSpecOf()` / `noteRailAttack()` · `gravekeeperGear.ts` | 同件正负同权重、炮台/机群隔离、战斗/视图同源、同型齐射一次叠层与读档续算专项；F2/F3 |
| 玩家实际承伤与齐射保护 | `applyPlayerUnitDamage()` · `combat.ts` | 层位/抗性/混伤/破盾后按实际掉血限制80%，损管保底后记账，100ms窗口及逐舰隔离专项；F2/F3 |
| 敌方选择玩家舰船的舰级与插件合成权重 | `playerTargetWeightOf()` · `combat/targeting.ts`；舰级基础值读同域`targeting.json` | 护卫至泰坦1/2/3/4/5、插件相乘、倾向先筛候选、单舰随机数、隐身/阵亡、真实敌炮敌机及读档专项；F2/F3 |
| 玩家舰载近盲开火与伤害 | `playerWeaponInRange()` / `playerBlindDamageMul()` · `combatMath.ts` | 最大射程内放行、近盲0.3、无人机原规则、近防打机群豁免、连发/逐炮/副段与预估专项 |
| 悬赏后台预热任务与缓存代次 | `BountyWinCache` · `game/bountyWinCache.ts`；真实评估仍为core `estimateBountyWinOn` | 单worker/每卡30局、失效取消/战斗让路、结果等价与双端真实worker响应专项 |
| 敌舰/机群/挂载/编队源数字参数读取 | `enemyParameterOf()` · `packages/core/src/enemyParameters.ts` | 六表字段契约、迁移前完整目录逐值相等及真实引擎预览专项；公式与引用留TS |
| 战斗演出跨场与读档续播 | `battleFxArrivals()` · `apps/desktop/src/renderer/src/ui/battleFxCursor.ts` | 绑定战斗对象、序号回退、陈旧事件与连续战斗专项 |
| 静态JSON参数与文本/派生绑定、数值编辑计划 | `staticDataGroup()` · `packages/data/src/staticData.ts`；`planDocuments()` · `tools/data-editor-schema.ts` | 固定基线目录等价、编辑事务与字段校验；JSON权威静态参数，公式/文本留代码 |
|---|---|---|
| 战前各舰实际预载与补给缺口 | `battleAmmoPreloadPlan()` · `battleAmmoPreflight.ts`，沿用实际选档/装弹顺序 | 预警与实际开战比对；首次不改状态、二次确认回归；`arch:guard` F2/F3 |
| 按卡距离与战前射程变化确认 | `battleCardRangeOf()` / `playerFleetMaxRangeOf()` / `withBattleRangeCheck()` / `pendingBattleRangeView()` / `sameShipRoster()` · `battleRangeMemory.ts` | 实际卡、全队有效射程、参战名单差异说明、待办落盘、配置重验及自动探索隔离专项；F2/F3 |
| 技能工作量、倍率切换与旧进度兼容 | `trainingLevelProgress()` / `normalizeTrainingProgress()` · `skills/training.ts`；技能时点推进在`skills/queue.ts` | 技能加速/离线专项、存档往返；`arch:guard` F2/F3 |
| 武器齐射整数扣弹与预付余额 | `battleWeaponAmmoCost()` · `combatAmmo.ts` | 半发不跨舰／组／弹种、读档不断额度、整数弹库存守恒 |
| 首次无人机出击间隔 | `droneLaunchGapMsOf()` · `droneLaunch.ts` | 每舰500毫秒、掠袭机库逐件缩短、复活重排、旧档续战；队列专项 |
| 船插安装列表与不叠加效果投影 | `plugModulesOf()` / `plugEffectsOf()` · `plugs.ts` | 安装件占格/回收与实际效果分离，重复安装不叠加仍占格；五族专项 |
| 支援件按伤害/装填/射程分池折权 | `supportEffectPartsOf()` / `stackWeight()` · `stacking.ts` | 跨型号同效果同池、强件优先；支援与插件惩罚专项 |
| 插件独立收益池及同件代价折权 | `plugEffectPartsOf()` / `plugStackingKindOf()` · `plugEffects.ts` | 战斗/CPU/货仓/机舱共用；协处理、选靶、扩槽和四件不叠势力插件例外 |
| CPU纯计算及船插候选预算 | `cpuBudgetOf()` / `fittedCpuUsed()` / `droneCpuUsed()` · `equipmentCpu.ts`，原`equipment.ts`公开入口委托 | 空间压缩超载原子拒装、原协处理预算及多舰装配回归 |
| 储备甲板实际补机周期 | `droneReviveCycleMsOf()` · `droneRevive.ts` | 甲板账本与本舰富卡同源，打印独立周期减免/中途重载专项 |
| 扩槽插件同类型限制 | `plugSlotExpansionKindOf()` / `plugSlotExpansionBlockedOf()` / `normalizePlugSlotExpansions()` · `plugs.ts`；`repairSlotExpansionPlugs()` · `equipment.ts` | 中低两类分别限一件、普通重复件保留、免费退库与幂等；F2/F3 |
| 全编队武器与装置周期 | `battleWeaponCyclesOf()` · `battleWeaponView.ts`；`battleDeviceCyclesOf()` · `battleDeviceView.ts` | 实际账本只读、僚舰覆盖、同舰同型数量与实际射程、动态装填、缺料与沉没状态；F2/F3 |
| 装备负面随收益折权、抗性减法与全战斗主动周期 | `fittedPenaltyPartsOf()` / `equipmentPenaltiesOf()` / `equipmentCycleMsOf()` · `equipment.ts` | 同型/混装排序、缺口边际、正负值一致、武器与主动周期/往返专项，F2/F3 |
| 敌舰受击增程的独立挂载件触发提示 | `announceFoeGunRangeBuff()` · `foeRange.ts`；说明继续走`mountEffectText()` | 主/副目标、独立文案、中英参数及原增程判定专项；`arch:guard` F2/F3 |
| 五类准备阵容清洗、恢复与记忆 | `cleanPreparationSquads()` / `preparationSquadOf()` / `notePreparationSquad()` · `preparationSquads.ts` | 五类隔离、实例顺序、缺船/忙态、显式空、旧档兼容与往返；页面通过统一选择hook接入；`arch:guard` F2/F3 |
| 我的舰队多套预设 | `cleanFleetPresets()` / `applyFleetPreset()` · `fleetPresets.ts` | 保存主控与成员顺序、停港预检、缺船/忙碌/超预算无部分切换、可选字段双轮往返 |
| 舰级与船体武器射程加成 | `shipWeaponRangeBonusesOf()` · `ships/range.ts` | T1～T5额外0/5/10/15/20%，与原船体特性加算；战前武器规格与舰船信息共用，不影响无人机和基础炮 |
| 制造卡势力插件图纸获取与隐藏 | `factionPlugBlueprintKind()` / `manufacturingBlueprintVisible()` · `features/industry/blueprintPolicy.tsx` | 一次性指向信号空间，永久未投放默认隐藏，已有配方/图纸/在制线保留；两套工业页共用 |
| 护盾力场排除自身、有效目标与最大护盾代价 | `pulseShieldFieldFor()` / `SHIELD_FIELD_COST_PCT` · `combatRepair.ts` | 力场专项：费用与目标数无关、足量/不足/无目标、周期/混装/读档；详情费用读取同一常量；`arch:guard` F2/F3 |
| 维修目标的装甲与结构容量倍率 | `repairCapacityMulOf()` · `repair.ts` | 普通维修与修理无人机共用；目标加成后最大值分别除以船型基础值，不按残血量计算 |
| 双方护盾自然回复与旗舰速率映射 | `passiveShieldRateOf()` · `combat/passiveRecovery.ts` | 当前盾比例、满盾托底、零盾不回；旗舰卡面速率基准与共享容量分离；战斗推进和估算共用 |
| 恒定承伤下护盾回复与装甲自愈的破层时间 | `passiveShieldBreakSeconds()` / `passiveArmorBreakSeconds()` · `combat/passiveRecovery.ts` | 解析估算共用回复规则；无法破层返回无限时长，装甲自愈独立于修复输出加成 |
| 无人机指挥共享增幅与全队已装载体积快照 | `applyDroneCommandAura()` / `droneCommandVolumeM3Of()` · `combat/droneCommand.ts` | 活友舰只取最高来源一次、不递归且排除本舰；全舰队已装载体积在开战时建档，来源目标权重无上限 |
| 版本化星系、坐标输入、搜索周期与候选容量 | `generateStellarSystem()` / `parseStellarSeed()` · `stellarGeneration.ts`；`stellarSearchDuration()` / `stellarCapacity()` / `stellarSystemDeveloped()` / `stellarCandidateCount()` · `stellarSearch.ts`；`cleanStellarState()` · `stellarSave.ts` | 同种子独立世界、预扣／暂停／连续搜索、基地保护、超过64星球往返专项 |
| 探测机专属材料折扣 | `probeMaterialFactor()` · `probeManufacturing.ts`；由既有 `matNeedCount()` 贯穿预览、投料、续产和退款 | 百万配方、全级折扣、普通蓝图隔离专项 |
| 星系动态视口与手势 | `stellarViewBox()` / `moveStellarGesture()` · `stellarMapView.ts` | 缩放锚点、旋转逆矩阵、双指减指、逐星系会话记忆专项 |
| 星球运行、供电、工程材料与运输 | `advancePlanetary()` / `planetRuntime.ts`；`planetColonyView()` / `planetColony.ts`；`cancelPlanetJob()` / `planetConstruction.ts`；`dispatchPlanetDelivery()` / `planetLogistics.ts` | 在线离线同值、实际扣料／到货、人口保护与保存专项，F9无环 |
| 战斗逐舰推进器点火与敌舰冲锋状态 | `battleArcsFor().myUnits[].boosting` / `.foeChargingTags` · `combat.ts`；复用`buildMyUnitSpecs`、`unitSpeedMulOf` | 加速特效专项：周期、捕获网、死亡、真实冲锋、重载及视图只读；`arch:guard` F2/F3 |
| 星球注入目录参数和引用校验 | `planetCatalogIssues()` · `planetCatalog.ts` | 生成入口与内容检查共用；非法参数、冲突引用、重复相邻规则专项 |
| 星球生成、勘探、环境、四向相邻、建设校验与存档 | `generatePlanet()` · `planetGeneration.ts`；`planetEnvironmentOf()` · `planetRules.ts`；`planetSurveyView()` · `planetSurvey.ts`；`planetAdjacencyOf()` / `planetConstructionCheck()` · `planetGrid.ts`；`cleanPlanetaryState()` · `planetSave.ts` | 独立种子、未知信息隔离、互斥、相邻封顶／断电与存档往返专项；`arch:guard` F2/F3 |
| 玩家整船回收/装备保全与战损插件 | `hullRecoveryChanceOf()` / `wreckEquipmentRecoveryChanceOf()` · `shipWrecks.ts`；`shipDamageEffects()` / `rollShipDamage()` · `shipDamage.ts` | 工程技能加算、首次判定/往返不重掷、六类最终属性及普通插件隔离；旧残骸规则兼容 |
| 战损管理按不同类型贡献动能与能量抗性 | `shipDamageHullResistOf()` · `shipDamage.ts` | 抗性按战损类型去重并受类型数上限约束；战损数组和每件属性惩罚仍保留 |
| 爆虫触发、本场腐蚀、全队孵化与巢母加速 | `triggerAcidBurst()` / `applyAlienCorrosion()` / `advanceFoeHatcheries()` / `advanceFoeAbilityClocks()` / `foeFleetSpeedMulOf()` · `alienCombat.ts` | 异形入侵专项：距离边界、伤害顺序、死亡去重、随档、有限/无限额度、多载体去重、有效时长与死亡解除；`arch:guard` F2/F3 |
| 限额慢补货：配置判据、初始化、周期进度、余额与统一核销 | `hasLimitedSupply()` / `ensureLimitedSupply()` / `advanceLimitedSupply()` / `limitedSupplyAvailable()` / `consumeLimitedSupply()` · `marketLimitedSupply.ts`；价格分档在`market/supply.ts:refreshLimitedSupplyBook()` | 市场限额专项、存档往返；`arch:guard` F2/F3；`content:check` 配置合法性 |
| 武器组炮数与逐炮守恒分摊 | `volleyGunCountOf()` / `volleyDamageShareOf()` · `combatVolley.ts` | 逐炮齐射专项；`arch:guard` F2/F3 |
| 黑市入口、候选资格、本地日界与下次刷新 | `blackMarketUnlocked()` / `blackMarketCandidateGoods()` / `blackMarketDayStart()` / `blackMarketNextRefresh()` · `blackMarket.ts` | `black-market-page-20261004.test.ts` · `arch:guard` F2/F3 |
| 黑市大宗原料排除 | `isBlackMarketBulkResource()` · `blackMarket.ts`，候选/购买和旧货架视图共用真实物品类型 | 原矿/原材料/气体/冰矿候选不进入、旧条目隐藏且拒买、不补抽/不改锁价、普通市场与无人机组货保持专项 |
| 黑市新货架组数量、锁定交付数与老货架单件兼容 | `blackMarketLotQuantity()` / `blackMarketOfferQuantity()` · `blackMarket.ts` | `black-market-drone-lots-20261006.test.ts`：四机型、总价/库存/售罄守恒、旧报价和读档 |
| 弹药可选档与设置合法性、普通市场可流通目录 | `ammoTiersOf()` · `ammoTiers.ts`；`marketTradingGoods()` · `market/access.ts` | MK3三系、设置/装配同源、黑市图纸渠道隔离回归 |
| 独占产物玩家交易定义与后台目录导出 | `PLAYER_ONLY_GOODS` · `packages/data/src/market/playerGoods.ts`；最终资格读 `marketTradingGoods()`，后台快照由 `tools/export-market-relay-metadata.ts` 导出 | 插件成品料价×10、势力插件图纸1亿、加密柜按实际奖池整柜期望×30%；非势力插件图纸不进市场；NPC货源与兑换资格不变 |
| 势力插件判据与加密柜估值输入 | `isFactionPlugId()` · `packages/data/src/plugs.ts`；`encryptedBlueprintPool()`、`ENCRYPTED_BLUEPRINT_COUNT` · `packages/core/src/encryptedContainer.ts` | 势力图纸生成与市场共用身份判据；开柜和估值共用奖池及张数范围，不另抄池或按成员总数平摊类别概率 |
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
| 技能取消的"连带失效"基线（只报/只删因本次取消才失效的项） | `preexistingUnmet()` · `skills/queue.ts` | core 用例 `skill-cancel-baseline-20260926.test.ts` |
| 存档清洗白名单（新增随档字段必须"写入点 ＋ 白名单"两处落笔） | `normalizeState()` · `save.ts` | `packages/core/tests/save.test.ts` 类型穷尽 ＋ `save:roundtrip-audit` |
| 伤害类型配色（动能/爆破/能量 同族同色） | 伤害配色契约（token 单点） | `npm run ui:theme-check` 的 `dmg-color-check` |
| 装备归属档（高/中/低/**舰船插件**四档） | `rackDimKeyOf()`（渲染层）＋ core `rackOf` | `content:check` 归属档契约 |
| 回收/打捞产出与价值读数 | core `industry/refining/params.ts` / `salvaging.ts` 的产出单点 | `npm run salvage:econ` · `recycle:compare` |
| 主控打捞真实返航时长（引擎/活动栏/星图同源） | `salvageReturnMs()` · `salvaging.ts` | `fuel-return-paths-20261022.test.ts`：半仓燃料返航、真实星图函数与活动栏50% |
| 采矿打捞停止/切换的新返航点火及已走航段接续 | `workReturnLeg()` · `trips.ts` | `fuel-return-paths-20261022.test.ts`：三入口、倍率/进度、读档、首拍换船及一次扣料 |
| 矿带每小时产出与行情产值 | `beltYieldRows()` / `beltValuePerHour()` · `mining.ts`，排序与卡面共用 | `belt-sort-value-20260930.test.ts` · `arch:guard` F2/F3 |
| 手动工作位占用，AI核心驱动不占主控 | `manualSlotOf()` · `activityGate.ts`，全部亲自工业共用 | `activity-lab-20261001.test.ts` · `arch:guard` F2/F3 |

## 二、data 表面（`packages/data/src`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 地表已公开地块图标与状态 | `planetSurfaceCellView` · `ui/planetSurfaceView.ts` | 网格/详情共用主体、资源、障碍与状态优先级，未知不渲染隐藏信息；设施完整覆盖/状态/真实组件专项 |
| 地表建筑身份色 | `planetBuildingTone` · `ui/planetSurfaceView.ts` | 网格/轮盘/详情统一，状态色独立；13项色表/主题专项 |
| 星球特性已公开效果详情 | `planetTraitDetails` · `ui/planetTraitDetails.ts` | 仅公开traitIds，直接修正/整星环境分列；富卡/触屏/未知隔离专项 |
| 星球迁移账单与预览 | `planetMoveBillOf` · `core/planetConstruction.ts` | 原账单值不变，原迁移/轮盘确认共用；费用与状态守恒专项 |
| 星球迁移合法性与选址 | `planetMoveCheck` · `core/planetConstruction.ts` | 原门禁抽取，实际迁移/高亮/确认共用，资源及保护/预占专项 |
| 地表轮盘逻辑边界 | `planetWheelPosition` · `ui/planetWheelGeometry.ts` | 逻辑区钳制，不按物理旋转尺寸/字数缩放，键盘/角落/手机专项 |
| 仿真上下文（页面取数的唯一入口） | `buildSimContext()` · `context.ts` | `arch:guard` F1/F4 |
| 玩家可见文案唯一表（`id → { zh, en }`） | `L10N` · `l10n/table.ts` | `npm run l10n:check` ＋ `l10n:list` |
| 已登记待译条目的中文回退 | `l10nEntryText()` · `l10n/table.ts`；界面`textOf`及主进程`t`调用 | 待译标记/文档登记成对、非待译空值仍拒绝、同入口占位符与中英渲染专项 |
| 内容名/说明的英文覆盖层 | `packages/data/src/l10n.ts`（`EN_*` ＋ `overlay*`） | `l10n:check` ＋ core `l10n-overlay.test.ts` |
| 势力族色 | `FOE_ACCENT` · `ui/tones.ts` | 与星图族标签/战场敌舰/图鉴族徽同源（人工核） |
| 势力图鉴最终展示清单 | `buildFactionCards()` · `factionCodex.ts` | 合并`FACTION_CODEX`与core的`FOE_LAIR_GEAR`，装备/物品和图纸分栏去重；内容护栏检查窝点池、引用、件型、重复及产物图纸，解锁仍按遭遇记录 |
| 物品稀有度分档 | `itemRarityTierOf()` · `rarityTier.ts` | `content:check` 稀有度契约 |
| 公告数据（**仅经船长批准后写入**） | `announcements.ts` | 约定 §十二（发布审核） |

## 三、渲染表现层（`apps/desktop/src/renderer/src`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 聊天 WebSocket 地址与 HTTPS 同源校验 | `cloudChatSocketUrl` · `features/cloud/api.ts` | API、token 编码与 CSP 专项；`arch:guard` F2/F3 |
| 同一连接跨频道聊天限频与批次调度 | `createChatQueue` · `features/cloud/chatQueue.ts` | 首帧与后续 3 秒、每帧 5 条、断线不重发已发送帧专项 |
| 跨窗口账号偏好缓存刷新 | `refreshCloudPreferences` · `features/cloud/preferences.ts` | 本机内存回退与跨窗口退出专项 |
| 应用级聊天连接、回执与历史合并 | `useOnlineChat` · `features/cloud/useOnlineChat.ts` | 实际生命周期、账号切换、历史/广播去重与本机真实后台冒烟 |
| 两个市场入口的商品名称与蓝图产物/材料悬停 | `marketGoodDisplayName()` / `blueprintHoverLines()` / `MarketGoodHover` · `ui/marketGoodHover.tsx` | `arch:guard` F2/F3；黑市浏览器专项 |
| 市场商品卡图标/分类/说明及完整详情 | `marketGoodInfo()` · `ui/marketGoodHover.tsx`；参数沿用仓库信息行，黑市场景不含参考价 | `arch:guard` F2/F3；黑市卡片详情回归 |
| 网页重连存档摘要与有效状态内容比较 | `reconnectProgress()` / `sameReconnectProgress()` · `game/saveReconnect.ts` | `save-reconnect-engine-20261004.test.ts` · `arch:guard` F2/F3 |
| 物品领域分类与未知条目兜底 | `itemCategoryOf()` · `ui/itemSubs.ts` | 筛选专项测试 · `arch:guard` F2/F3 |
| 市场领域与细分判定 | `marketDomainPasses()` · `ui/itemSubs.ts` | 筛选专项测试 · `arch:guard` F2/F3 |
| 引擎与 `ctx` 的产地（页面取数都从它来） | `GameEngine` · `game/engine.ts` | `arch:guard` F1/F4 |
| 标签取词（槽类/槽位/舰级/地点/机型/物品大类…） | `labelsText.ts`（`kindText` 一族） | `ui:subs-check` 的「本地化直读契约」 |
| 舰船子类取词 | `ui/labelsText.ts` 的 `shipSubClassText`，舰队卡与详情共用 | `Record<ShipSubClass, string>`穷尽、英文实机巡检 |
| 次数链名称取词 | `data/src/l10n.ts` 的 `firstChainText`，里程碑任务与成就说明共用 | 本地化专项测试、英文实机巡检 |
| 族徽判据与势力可访问全称 | `crestFamOf()` / `crestLabelOf()` · `ui/labelsText.ts`，图鉴与物品网格共用 | `ui:attr-check`族徽判据契约 |
| 图鉴卡片构造（装备/舰船/物品/蓝图/势力同源） | `itemCellOf()`等builder · `panels/handbookDetail.tsx` | `ui:attr-check` ＋ `arch:guard` F2 |
| 取色跨表兜底 | `toneOfAny()` · `ui/tones.ts` | 人工核（约定 §九） |
| 悬停提示接管层（全站唯一延迟 500ms 与"内层优先"） | `ui/Tooltip.tsx`（`TIP_DELAY_MS`） | `ui:tip-check` ＋ `ui:rot-check` |
| 悬浮窗逻辑空间限宽与边缘定位 | `tooltipLayout()` · `ui/tooltipGeometry.ts` | 首帧/实测共用，桌面560/旋转600上限与可用区约束，窄窗/四角专项 |
| 悬停富卡皮肤（模块/物品/舰船参数表） | `ui/shipInfo.tsx`（`infoCardContent` 一族） | 约定 §九之七（人工核） |
| 视口懒挂载（大列表流式加载） | `ui/LazyMount.tsx` | `industry:lag` 读数 ＋ 人工核 |
| 活动栏「停止/取消」按钮文案（两套外壳共用） | `panels/activityStopLabel.ts`的`stopLabel()` | `arch:guard` F2 |
| 活动栏行跳转表（两套外壳共用） | `ui/activityGo.ts`的`goFor()` | `arch:guard` F5跳转目标契约 |
| 入侵循环下一目标与实际抽卡冷却（在线/离线与活动栏同源） | `autoLoopInvasionPlanOf()` · `core/expedition.ts` | 入侵路线专项：外围顺序、核心后置、只读抽签、等待与进度一致；`arch:guard` F2/F3 |
| 属性表拼装（装配页/图鉴/蓝图产物/舰队悬停四处） | `ui/shipInfo.tsx` 的行工厂 | `ui:attr-check` 的「同名两行」体检 |
| 音效语义 id 与默认增益/节流（调用点、素材文件名、音效台共用） | `SFX_CUES` · `game/audio/cues.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| 音效播放唯一出口（音量、节流、并发、本机覆盖优先） | `playCue` · `game/audio/player.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| 日志→音效触发规则与素材文件名匹配 | `matchLogCue` / `matchSfxFileName` · `game/audio/rules.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| BGM/环境场景解析（战斗>虫洞>入侵>停靠>太空） | `resolveSfxScene` · `game/audio/scene.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| 音高随机换速率（音分 → playbackRate） | `pitchRateFor` · `game/audio/rules.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| 音效正式入库包格式与素材路径映射（音效台导出、`audio:install` 与自检共用） | `buildSfxPack` / `sfxPackAssetPath` · `game/audio/sfxPack.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| BGM/环境底噪交叉淡变时长（换曲 2.5s / 1.5s、同曲调音量 250ms） | `BGM_CROSSFADE_MS` / `AMBIENT_CROSSFADE_MS` / `VOLUME_FADE_MS` · `game/audio/rules.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| 场景音频强切（真实场景 + 调试预演；只切声音，不动存档与画面） | `reportRealSfxScene` / `forceSfxScene` / `effectiveSfxScene` · `game/audio/sceneSwitch.ts` | `npm run audio:check`；`arch:guard` F2/F3 |
| 实时触发日志（环形缓冲 60 条，试听不计） | `recordSfxPlay` / `sfxPlayLog` · `game/audio/playLog.ts` | `npm run audio:check`；`arch:guard` F2/F3 |

## 四、工具与文档层（`tools/` · `docs/`）

| 关注点 | 唯一实现 | 护栏 |
|---|---|---|
| 正式工具与临时探针的区分与收尾 | 约定 §十（`tools/xxx.ts` vs `tools/_*.ts`） | `npm run tools:audit` |
| 非归档文档索引 | `docs/INDEX.md`（仅由 `npm run docs:index` 生成） | `docs:index --check`；读取前跳过archive目录 |
| 过程归档与历史禁读 | 开发约定§十五、`AGENTS.md` | 当前结论与未决摘要人工核对，归档原文按字节校验 |
| 工作文档 → 归档三步 | 约定 §十五 | 人工核（本批列出） |
| 本索引自身与护栏注册表的同步关系 | 本文件（人读索引）＋ `tools/arch-guard.ts` 的 `SINGLE_SOURCE`（机器执行源） | `arch:guard` F3 只核对机器执行源的源码落点；两份文字表同步由人工维护 |

## 五、维护纪律（三条）

1. **新派生值先登记再写码**：先在 `tools/arch-guard.ts` 的 `SINGLE_SOURCE` 加一项，再在本表补一行 ⇒ 再去写实现；`arch:guard` F2 会对"已登记单点被别处再写一份"报红。
2. **护栏栏写不出东西的条目** ⇒ 标 🟡「待补护栏」，不许假装已经上锁（人工核也是护栏，但要写明"人工核"）。
3. **本表与代码不一致时以代码为准**，当场改本表；改完跑 `npm run arch:guard` 复核（F3 会挡住悬空条目）。

---

_条目增删随代码走；规则变更仍按开发约定的工作文档与归档流程处理。_

## 分目录实现落点

| 符号 | 唯一实现 |
|---|---|
| `achievementReached`、`chainProgress`、`advanceAchievements`、`achievementOverview`、`achievementCount` | `packages/core/src/achievements/rules.ts`；原`achievements.ts`仅具名转导出，成就/铁人专项验证 |
| `ACHIEVEMENTS`、`achievementOf`、`achievementsOfChain` | `packages/data/src/achievements/catalog.ts`；数据、上下文与成就页面共用原目录顺序 |
| `fittingRangeStats` | `packages/core/src/combat/fittingRange.ts` |
| `acidResistsOf` | `packages/core/src/combat/alienEquipment.ts` |
| `foeAcidRowsOf` | `packages/core/src/combat/alienEquipment.ts` |
| `battleSpeedBonusOf` | `packages/core/src/combat/alienEquipment.ts` |
| `laserFalloffOf` | `packages/core/src/ships/fitting/effects.ts` |
| `battleAmmoPreloadPlan` | `packages/core/src/combat/battleAmmoPreflight.ts` |
| `battleCardRangeOf` | `packages/core/src/combat/battleRangeMemory.ts` |
| `playerFleetMaxRangeOf` | `packages/core/src/combat/battleRangeMemory.ts` |
| `withBattleRangeCheck` | `packages/core/src/combat/battleRangeMemory.ts` |
| `pendingBattleRangeView` | `packages/core/src/combat/battleRangeMemory.ts` |
| `sameShipRoster` | `packages/core/src/combat/battleRangeMemory.ts` |
| `foeFamilyHpMulOf` | `packages/core/src/combat/foePower.ts` |
| `SHIP_HP_UPLIFT_MUL` | `packages/core/src/combat/combatMath.ts` |
| `crisisEffectsOf` | `packages/core/src/combat/gravekeeperGear.ts` |
| `playerGravekeeperSpecOf` | `packages/core/src/combat/gravekeeperGear.ts` |
| `noteRailAttack` | `packages/core/src/combat/gravekeeperGear.ts` |
| `applyPlayerUnitDamage` | `packages/core/src/combat/damage.ts` |
| `foeShipHpMulOf` | `packages/core/src/combat/foePower.ts` |
| `playerWeaponInRange` | `packages/core/src/combat/combatMath.ts` |
| `playerBlindDamageMul` | `packages/core/src/combat/combatMath.ts` |
| `BountyWinCache` | `apps/desktop/src/renderer/src/features/combat/estimate/bountyWinCache.ts` |
| `enemyParameterOf` | `packages/core/src/combat/enemyParameters.ts` |
| `battleFxArrivals` | `apps/desktop/src/renderer/src/features/combat/battleFxCursor.ts` |
| `battleWeaponAmmoCost` | `packages/core/src/combat/combatAmmo.ts` |
| `droneLaunchGapMsOf` | `packages/core/src/combat/droneLaunch.ts` |
| `repairSlotExpansionPlugs` | `packages/core/src/ships/fitting/repair.ts` |
| `autoLoopInvasionPlanOf` | `packages/core/src/expedition/invasionLoop.ts` |
| `battleWeaponCyclesOf` | `packages/core/src/combat/battleWeaponView.ts` |
| `battleDeviceCyclesOf` | `packages/core/src/combat/battleDeviceView.ts` |
| `fittedPenaltyPartsOf` | `packages/core/src/ships/fitting/effects.ts` |
| `equipmentPenaltiesOf` | `packages/core/src/ships/fitting/effects.ts` |
| `equipmentCycleMsOf` | `packages/core/src/ships/fitting/effects.ts` |
| `announceFoeGunRangeBuff` | `packages/core/src/combat/foeRange.ts` |
| `SHIELD_FIELD_COST_PCT` | `packages/core/src/combat/combatRepair.ts` |
| `pulseShieldFieldFor` | `packages/core/src/combat/combatRepair.ts` |
| `battleArcsFor` | `packages/core/src/combat/arcs.ts` |
| `triggerAcidBurst` | `packages/core/src/combat/alienCombat.ts` |
| `applyAlienCorrosion` | `packages/core/src/combat/alienCombat.ts` |
| `advanceFoeHatcheries` | `packages/core/src/combat/alienCombat.ts` |
| `advanceFoeAbilityClocks` | `packages/core/src/combat/alienCombat.ts` |
| `foeFleetSpeedMulOf` | `packages/core/src/combat/alienCombat.ts` |
| `volleyGunCountOf` | `packages/core/src/combat/combatVolley.ts` |
| `volleyDamageShareOf` | `packages/core/src/combat/combatVolley.ts` |
| `coronaFocusBonusOf` | `packages/core/src/combat/coronaFocus.ts` |
| `coronaFleetRangeBonusOf` | `packages/core/src/combat/coronaFocus.ts` |
| `supportFoeModelTagOf` | `packages/core/src/combat/foeCard.ts` |
| `applyFleetLockAura` | `packages/core/src/combat/lockAura.ts` |
| `lockAwareFoe` | `packages/core/src/combat/targeting.ts` |
| `beginOfflineCombatStats` | `packages/core/src/offlineCombatStats.ts` |
| `signalAutoEstimateOf` | `packages/core/src/signalAuto/estimate.ts` |
| `signalAutoOrdinaryHoldShareOf` | `packages/core/src/signalAuto/estimate.ts`；仅分配下潜途中普通作业回合，最终容量仍用完整货舱 |
| `cleanSignalAutoEstimate` | `packages/core/src/signalAuto/save.ts` |
| `signalAutoCombatRatio`（旧解析对照，不供新任务放行） | `packages/core/src/signalAuto/combat.ts` |
| `signalAutoGuardBattleOf`（新任务逐层正式守卫战隔离推演） | `packages/core/src/signalAuto/guard.ts` |
| `signalAutoInputKey`（后台推演提交前输入一致性） | `packages/core/src/signalAuto/input.ts` |
| `SIGNAL_AUTO_COMBAT` | `packages/core/src/signalAuto/combat.ts` |
| `SIGNAL_AUTO_ESTIMATE_CONFIG` | `packages/core/src/signalAuto/estimate.ts` |
