# 待发公告整合与遗漏核对

> **状态：待船长审核；核对完成，未写入公告表，未推送**（零号 · `dsh/system-search-20261007` · 2026-10-08）
> **船长原话**：「合并检查所有待发的公告和是否有其他需要公告的内容」
> **范围**：核对主树、远端跟踪基线、独立及工作文档内的公告草稿，整理一份中英文总待审稿；不修改游戏规则、已发布公告、旧稿或个人档。
> **待裁决**：七张整合公告的正文与发布安排；活动栏入侵标签仍属试做，未经观感验收不作为定案宣传。

## 一、核对结论

- 核对主树`aa0ae11c`，`origin/main`为`20cd1b94`，业务核对时相差49个提交。只读`git ls-remote`直连超时后，经命令级临时代理确认GitHub主分支仍为该提交；不修改持久代理配置，不推送。
- `announcements.ts`在两端完全相同：最近这批本地业务尚未新增正式公告。文件名带“待审”不等于仍待发，需看正文和实际公告ID。
- 真正独立待审稿4份：异形、护盾／装备／舰船图纸、残骸／收购、信号空间。另从工作文档提取回收、沉船装配、战斗周期、入侵循环，以及此前已入远端跟踪基线却未公告的黑市、MK3弹药、虚空晶供给和逐炮命中。
- 建议整理为下面七张主题公告。前六张说明本轮主要变化，第七张补齐已上线内容；不把“补公告”写成“本轮才上线”。
- 星球建设、种子星系、深空探测机与新虫洞仍未向普通玩家开放，不进上线公告。数据编辑器、测试档、内部钩子、工具和重构不进玩家公告。
- 正式落库日期按实际发布日核对。异形稿涉及10月9日20:00排期，必须在发布前再次核对时间；过时不照抄“将迎战”。该时刻沿游戏设备本地时间，不擅自写成全球统一北京时间。

## 二、来源与处置

| 来源 | 核对结果 | 整合位置 |
|---|---|---|
| `announcement-draft-alien-invasion-20261007.md` | 未入公告表；补腐蚀叠加和信号发射器可随机召来C族 | 第1张 |
| `announcement-draft-shield-field-20261007.md` | 未入公告表；保留三批整合，写清原舰价50%改10%，不是按旧价再乘10% | 第3张 |
| `announcement-draft-wreck-loot-buy-20261007.md` | 未入公告表；“完好舰体”只是敌方打捞出装备事件，不是玩家整船回收 | 第4张 |
| `announcement-draft-signal-space-20261006.md` | 改名已入远端跟踪基线，公告仍未入表；不重宣称新虫洞开放 | 第7张 |
| `ship-wreck-recovery-20261007.md` | 大系统，只有嵌入草稿；补概率、失败永久损失、无人机独立及交易限制 | 第2张 |
| `wreck-fit-repeat-plugs-20261007.md` | 未入表；补重复插件、沉船富详情、保存方案 | 第2张 |
| `ship-damage-inline-display-20261007.md`／`fleet-hide-plugs-20261008.md` | 早稿“三页普通插件并列”被后续舰队隐藏普通插件覆盖 | 第2张按最新界面写 |
| `battle-mount-readiness-speed-20261008.md` | 未入表；武器／装置／捕获网／首发规则，巢母基础速度未改 | 第5张 |
| `invasion-autoloop-route-20261008.md` | 未入表；自动收复路线改变，不能当成仅增加进度条 | 第6张 |
| `squad-memory-auto-gate-20261007.md` | 未独立备公告；主控作业误拦修复与公开准备入口记忆值得补上 | 第6张 |
| `acid-burst-stacking-fx-20261007.md` | 腐蚀现在逐次累计并可负抗性；异形旧稿未说清 | 第1张 |
| `invasion-wreck-ordinary-decrement-20261007.md` | 旧筛选绕开入侵池修复，需说明实际扣量而非“无限残骸” | 第4张 |
| `missile-hulk-mount-copy-20261007.md` | 小修，不能写成新增导弹增程机制 | 第5张挂载说明一项 |
| `per-gun-volley-20261005.md` | 已入远端跟踪基线，未入公告；“装填保持原规则”不再适合总稿 | 第5张不作新增炮数宣传，保留逐炮规则说明 |
| `black-market-page-20261004.md`／`black-market-drone-lots-20261006.md` | 黑市已上线；旧“一件”与新“50架一组”不符 | 第7张 |
| `ammo-mk3-black-market-20261006.md`／`market-limited-supply-20261006.md` | 已入远端跟踪基线，无正式公告；应补来源和供给限制 | 第7张 |
| 09-26战列舰、09-29经济／技能、09-30实验室、10-02光环稿 | 对应ID已在主树及远端跟踪基线公告表；部分文档前置提示过期 | 不重复发布，不回改历史数字 |
| 10-04货舰与海牛 | `ann-hauler-refit-20261004`已正式入表 | 不再新建同内容公告 |
| `activity-invasion-badge-20261008.md` | 只有试做授权，仍待观感验收 | 暂不写“新增入侵标签”；第6张只说已确认的进度与目标 |
| `planetary-*.md`／`stellar-*.md`／未来虫洞 | 普通入口关闭或仅调试可达 | 不列为上线内容 |

### 早期九项候选的处置建议

09-29尚有A/B/E/F四项、09-30尚有B/C/D/E/F五项，合计九项。它们没有正式公告ID，不把“建议发”当批准，也不因为时间久就擅自销账。

| 旧稿项目 | 当前核查与过期点 | 建议 |
|---|---|---|
| 09-29 A 拆船回收 | `scrap.ts`仍提供插件区入口、料单50%向下取整、两次确认和装备返库；是主动拆船，不是打捞沉船 | 附录A补告候选，推荐发 |
| 09-29 B 无人机体系 | 甲板旧15/10/6秒已为14/12/9秒；备用机来源不只货舱；本轮装填代价会延长实际周期 | 附录B按现行数值改写，不照发旧稿 |
| 09-29 E 入侵旧规则 | 黑匣击杀奖励、60/40贡献规则已上线；不是本次自动路线改动 | 并入第6张的可选第5条，不独立成卡 |
| 09-29 F 沉船与保存修复 | 沉船记录已在第2张说明；遭遇/旗舰丢船、扩槽保存、导入入口、旧近防修复都是更早内容 | 不建议另发整张；沉船/扩槽可并入主题，不重复宣传为新增 |
| 09-30 B 鲸王级 | 当前4/3/3、CPU230、跃迁3.5AU/s；旧“说明补一句”不值得单独公告 | 附录B第3条补告候选 |
| 09-30 C 顶栏声望 | 显示余额/悬停累计为旧界面变化；累计门槛已在插件兑换正式公告说明 | 不建议再发整张，保留为可选补充，不自动销账 |
| 09-30 D 技能队列 | 队列读数/置顶/溢出属于旧界面修复，无新训练机制 | 不建议独立补告，保留为可选补充 |
| 09-30 E 燃料/实验室界面 | 旧“上限6000”已过期，实验室主稿已发；液面/重复单位等是小修 | 不建议独立补告，不复制旧数字 |
| 09-30 F 稀有残骸MK2池 | 现为信号空间；未命中专属时按MK2:MK3=1:0.25抽组，不是“所有稀有残骸80%出MK2” | 已并入第4张第2条，注明不追补 |

30份归档公告均已发布、合并取代或明确不发，无需重新整份递审。特别核对：09-11最终批复已作废旧舰船尺寸公告；09-19残骸归并已批准发布；09-26按组选择打捞对象明确不发。09-12敌人重做稿虽然留有“作废”稿头，其公告ID仍在已发布表中，不能因此再发一次。

## 三、玩家公告整合稿

以下是供审核的正文。建议ID仅预留在本稿，尚未登记`ano.*`词条或写入发布表；批准后再按唯一双语表落库。日期暂拟2026-10-08，发布时复核。

### 1. 异形虫群入侵

ID：`ann-alien-invasion-20261007`；分类：内容 / Content。

1. 玩家将在10月9日20:00开始的入侵中迎战异形虫群。常规入侵势力按光环科技、异形生物、墨潮帮轮换；信号发射器也可能召来异形入侵。
2. 酸液爆虫会贴近爆发并自毁，近距离被击杀时也会爆发。每次爆发使玩家编队的装甲、结构抗性再降低15个百分点，可降至负值；腐蚀持续至本场战斗结束，不影响护盾和无人机。
3. 哺育工虫能修复同伴；背巢巨兽和巢母巨兽以颚钳虫群为主要火力，并能补回战损虫群。巢母还能复活哺育工虫，存活期间逐步提高虫群舰队速度。
4. 玩家可打捞异形入侵普通、稀有残骸；稀有残骸经回收炉解体有机会获得生体甲壳板、生体损管腔和酸液喷吐器。击沉巢母可获得异形旗舰黑匣，用于制造舰船插件。
5. 酸液爆虫使用专属自爆与酸液附着效果，不再显示为能量武器射击。

Title: Alien Swarm Incursion

1. Players will face alien swarms in the incursion starting at 20:00 on October 9. Regular incursions rotate through Corona Systems, Alien Lifeforms and the Ink Tide Gang. Signal Emitters can also summon alien incursions.
2. Acid Bursters close in, burst and self-destruct, and also burst when destroyed at close range. Each burst reduces the player's fleet armor and hull resistances by another 15 percentage points, allowing negative resistance. Corrosion lasts until the battle ends and does not affect shields or drones.
3. Brood Workers repair their allies. Hiveback and Broodmother Behemoths rely on Jawclaw Swarms and replace destroyed swarm units. A living Broodmother also revives Brood Workers and gradually increases its fleet's speed.
4. Players can salvage ordinary and rare alien incursion wrecks. Recycling rare wrecks can yield Bio Carapace Plates, Bio Damage Control Chambers and Acid Sprayers. Destroying the Broodmother awards an Alien Flagship Black Box for manufacturing ship plugs.
5. Acid Bursters use dedicated self-destruction and acid-coating effects instead of energy-weapon fire.

### 2. 舰船回收与沉船装配

ID：`ann-ship-recovery-fitting-20261008`；分类：系统 / System。

1. 玩家在正常星系中被摧毁的舰船可通过打捞尝试整船回收，基础成功率25%。回收舰船拖回母港，装甲与结构各保留20%；信号空间不生成此类玩家舰船残骸。
2. 工程新增舰体打捞工程学、高级舰体打捞工程学和装备保全工程学。前两项每级分别增加5、4个百分点整船回收率，彼此加算；成功回收舰船时，普通装备基础保全率80%，装备保全工程学每级增加4个百分点，满级100%。无人机仍独立判定，货舱货物和预载弹药不返还。
3. 新产生的玩家沉船残骸，每件普通装备只判定一次，未保全的装备永久损失；成功保全但无法重新装载的装备退回装备库。
4. 整船回收成功后有50%概率新增一个战损插件，单项属性降低15%，同类不重复、最多三个。战损在插件区域显示但不占普通安装名额，常规维修不会清除；带战损的舰船不能入仓或挂售。
5. 玩家可安装多件同型普通插件，仍受原槽位和不可拆换规则限制。通讯沉船记录可查看装备、插件、无人机详情并保存到对应船型的装配方案，插件仅作参考、不自动安装；普通插件在装配页与沉船记录中查看，舰队列表保留战损警告。

Title: Ship Recovery and Wreck Loadouts

1. Players can attempt to recover whole ships destroyed in normal star systems, with a base success chance of 25%. Recovered ships return to the home port with 20% armor and hull condition. Signal Space does not leave these player ship wrecks.
2. Engineering gains Hull Salvage Engineering, Advanced Hull Salvage Engineering and Equipment Preservation Engineering. The first two add 5 and 4 percentage points of ship recovery chance per level, respectively, and stack additively. Successful ship recovery preserves ordinary equipment at a base chance of 80%; Equipment Preservation Engineering adds 4 percentage points per level, reaching 100% at maximum level. Drones are rolled separately; cargo and preloaded ammunition are not restored.
3. Each ordinary module in a newly created player ship wreck receives one preservation roll. Failed rolls permanently lose that module. Preserved modules that cannot be refitted are returned to the module bay.
4. Successful ship recovery has a 50% chance to add a damage plug that reduces one attribute by 15%. Damage types do not repeat, with up to three per ship. They appear in the plug area without using normal installation slots and are not removed by ordinary repairs. Ships with damage plugs cannot be stored or listed for sale.
5. Players can install multiple copies of a normal plug within existing slot limits; plugs remain non-removable and non-replaceable. Wreck records in Comms show module, plug and drone details and can save the loadout as a preset for its ship type. Plugs are references only and are not installed automatically. Normal plugs remain visible in Fitting and wreck records, while the fleet list retains damage warnings.

### 3. 护盾力场、装备代价与舰船蓝图调整

ID：`ann-shield-field-20261007`；分类：数值 / Balance。

1. 护盾充能力场装置MK2、MK3不再恢复装载舰自身的护盾，只恢复玩家编队中其他存活舰船。每次有效充能消耗装载舰最大护盾值的10%，不因恢复队友数量增加而多扣；不同型号独立触发，分别支付。
2. 装载舰护盾不足最大值的10%，或没有存活队友需要恢复时，力场不发动、不扣盾。恢复量仍按装载舰最大护盾计算，MK2、MK3基础周期仍为10秒、8秒，同舰多装恢复量递减。
3. 巨构协处理器每件仍增加90 CPU，单件装填代价由12%降至8%，多件代价相乘。代价作用于本舰全部武器及无人机攻击间隔，并延长护盾充能、力场、维修、捕获网和无人机储备甲板的周期；不改变推进器点火、冷却或采矿、打捞作业周期。
4. 装备的速度、射程和命中代价改为逐件相乘，抗性代价逐件减去百分点，抗性仍可降至负值。有多装递减的装备，负面效果也随同一件的收益递减，不再只取最重的一份代价。
5. 全部一次性舰船蓝图的基础价格由对应舰船基础价格的50%下调至10%，永久蓝图、装备和无人机图纸价格不变。皇带鱼级一次性蓝图改为只收不卖，已有图纸仍可制造或出售，原有掉落保留。

Title: Shield Fields, Equipment Penalties and Ship Blueprint Adjustments

1. Shield Charge Field MK2 and MK3 no longer restore the carrier's own shield, only shields on other surviving ships in the player's fleet. Each activation that restores an ally consumes 10% of the carrier's maximum shield capacity, regardless of the number of allies restored. Different models activate and pay their costs independently.
2. The field neither activates nor consumes shield when the carrier has less than 10% of maximum shield capacity or no surviving ally needs restoration. Restoration remains based on the carrier's maximum shield capacity. MK2 and MK3 retain base cycles of 10 and 8 seconds, with diminishing restoration from multiple fields on one ship.
3. Each Megastructure Coprocessor still adds 90 CPU. Its reload penalty falls from 12% to 8% per module and multiplies across modules. It affects all of the carrier's weapons and drone attack intervals, plus shield recharge, shield field, repair, capture web and Drone Reserve Deck cycles. Thruster boost duration and cooldown, mining and salvaging cycles are unchanged.
4. Equipment speed, range and accuracy penalties now multiply across modules. Resistance penalties subtract percentage points and can cause negative resistance. Where a module has diminishing returns, its penalties follow the diminishing benefit of that same module, instead of only applying the largest penalty.
5. Base prices for all single-use ship blueprints fall from 50% to 10% of the corresponding ship's base price. Permanent, equipment and drone blueprint prices are unchanged. The Oarfish-class single-use blueprint becomes buyback-only; existing copies can still be used or sold, and existing drop sources remain.

### 4. 残骸回收与装备收购调整

ID：`ann-wreck-loot-buy-20261007`；分类：数值 / Balance。

1. 玩家在打捞中触发完好舰体装备发现时，装备从民用、MK1与该类残骸的特色装备中随机获得，不再固定给予同一种特色装备。
2. 光环、墨潮帮、异形入侵及守墓者高安稀有残骸的通用装备池扩充，仍有机会获得对应势力的专属装备。信号空间稀有残骸未获得专属装备时，通用装备从MK2、MK3两组按1:0.25权重抽取；此前只进入MK3池的问题已修复，已结算的掉落不追补。
3. 势力与信号空间专属装备的基础收购价降为原来的25%。护盾充能力场MK2、MK3、隐秘行动装置MK3、损伤管制装置MK3和跃迁计算机MK3的基础收购价调整为200万信用点，实际报价仍随行情浮动；装备属性、购买价格与黑市报价规则不变。
4. 玩家挂售中的专属装备计入持有数量，未成交挂单不再使该装备被优先补发。已有物品、信用点和锁定挂单价格保持不变，新生成报价使用调整后的价格。
5. 修复旧残骸筛选导致入侵普通残骸库存不下降的问题。有入侵残骸时按原优先规则打捞，稀有轮不扣普通池；稀有残骸捞完后，普通轮正常扣减入侵普通残骸库存。

Title: Wreck Recovery and Equipment Buyback Adjustments

1. When salvaging triggers an intact-hull equipment find, players receive a random item from civilian, MK1 and the wreck's themed equipment pools instead of always receiving the same themed item.
2. Standard equipment pools for rare Corona, Ink Tide and alien incursion wrecks, and rare high-security Gravekeeper wrecks, are expanded. Faction-exclusive equipment remains available. When a rare Signal Space wreck does not yield exclusive equipment, its standard equipment is drawn from MK2 and MK3 groups with weights of 1 and 0.25. The issue that previously used only the MK3 pool is fixed; previous drops are not awarded again.
3. Base buyback prices for faction-exclusive and Signal Space-exclusive equipment fall to 25% of their previous values. Shield Charge Field MK2 and MK3, Stealth Module MK3, Damage Control Unit MK3 and Warp Computer MK3 have base buyback prices of 2 million credits. Actual quotes still fluctuate with the market. Equipment attributes, purchase prices and black-market pricing rules are unchanged.
4. Exclusive equipment listed for sale counts as owned until sold, so pending listings no longer make it a priority replacement. Existing items, credits and locked listing prices are unchanged; newly generated quotes use the adjusted prices.
5. A fix prevents old wreck filters from bypassing incursion wreck stock. Incursion wrecks retain their existing salvage priority. Rare-wreck rounds do not consume ordinary stock; once rare wrecks are exhausted, ordinary rounds correctly deduct ordinary incursion wrecks.

### 5. 战斗装填与状态显示

ID：`ann-battle-cycles-20261008`；分类：系统 / System。

1. 新战斗中，玩家舰炮、近防炮和无人机先完成自身一轮实际装填再开火；敌舰开场规则不变，正在进行的战斗和换波不重置玩家装填。齐射继续逐门判定命中，激光必中规则不变。
2. 战斗武器装填统一收进武器列表，按舰船分组、每件武器独立一行，无人机按本舰机型汇总。桌面悬停向下展开，也可点击固定；手机可点按查看，列表内部滚动。
3. 推进器、维修、护盾充能、力场、捕获网、无人机储备甲板和跃迁规避装置在面板显示真实周期与状态；缺料、停机、机群损失和舰船沉没不会显示为就绪。
4. 修复主控和僚舰捕获网连线缺失，被网敌舰显示束缚状态，详情显示施放舰、目标和减速。修复长时间推进及读取战斗后减速异常；巢母巨兽基础速度未调整。
5. 敌舰挂载详情逐件一行、名称染色，导弹残段增程提示使用自身装置名称；手册机动只显示速度，不再附倍率。短高度与手机窗口中的列表、装置和操作区布局同步改善。

Title: Battle Reload and Status Displays

1. In new battles, player guns, point-defense weapons and drones complete one actual reload cycle before firing. Enemy opening rules are unchanged. Existing battles and wave transitions do not reset player reloads. Salvos continue to roll hits per gun, and lasers retain guaranteed hits.
2. Weapon reloads move into a Weapons list grouped by ship, with one row per installed weapon and drones grouped by model on each ship. Desktop hover opens the list downward, clicking pins it, and mobile players can tap to open it. The list scrolls internally.
3. Thrusters, repairs, shield recharge, shield fields, capture webs, Drone Reserve Decks and Warp Evasion Devices show their actual cycles and states on the panel. Missing supplies, stopped devices, lost drone groups and sunk ships are not shown as ready.
4. Missing capture-web links from player lead ships and escorts are fixed. Webbed enemies show a status badge, with the caster, target and slowdown in details. Incorrect slowdown during long simulation steps and after loading a battle is also fixed. The Broodmother Behemoth's base speed is unchanged.
5. Enemy mount details use one row per mount with colored names. Missile Hulk range notifications name its own device. The handbook shows speed without an additional multiplier. Lists, devices and controls also receive layout improvements for short and mobile windows.

### 6. 入侵重复出击与队伍准备

ID：`ann-invasion-repeat-prep-20261008`；分类：系统 / System。

1. 玩家开启入侵重复出击后，当前星系收复时自动切换目标，先收复外围，最后收复核心；当前战斗和返航照常完成，不中途改换目标。
2. 外围与核心全部收复后，重复出击自动停止，旗舰仍需玩家手动挑战。已收复星系仍可手动出击，残骸减半规则不变。
3. 新旧界面的活动栏显示入侵重复出击的目标、真实冷却进度和剩余时间；返航时停止重复出击不会中断当前返航。
4. 信号空间手动、自动与入侵旗舰准备分别记忆上次选择的舰船和顺序。主控未加入自动探索队伍时，主控正在作业不再误挡副船队出发；实际参队舰船仍需满足原有条件。

可选第5条，补旧规则而非本次改动：玩家亲手击沉旗舰可获得对应旗舰黑匣；贡献按旗舰输出占六成、清缴进度占四成计算。入侵期间常驻悬赏照常发放，低安遇袭不再扣走信用点。

Title: Invasion Repeat Assault and Squad Preparation

1. When players enable invasion repeat assault, it switches targets as each system is reclaimed, clearing the periphery before the core. Current battles and return trips finish normally without changing their targets mid-trip.
2. Repeat assault stops once all peripheral and core systems are reclaimed. Players must challenge the flagship manually. Manual sorties remain available in reclaimed systems, with the existing half-wreck yield unchanged.
3. Both interface layouts show the repeat-assault target, actual cooldown progress and time remaining. Stopping repeat assault during a return trip does not interrupt that trip.
4. Manual Signal Space, automatic Signal Space and invasion flagship preparation remember their last selected ships and order separately. If the player-controlled ship is not in an automatic exploration squad, its ongoing work no longer incorrectly blocks the escort squad from departing. Participating ships must still meet existing requirements.

Optional bullet 5: Players who personally destroy a flagship receive its faction's flagship black box. Contribution is weighted 60% by flagship damage and 40% by reclamation progress. Standing bounties remain available during incursions, and low-security encounters no longer take credits.

### 7. 探索与市场补充说明

ID：`ann-exploration-supply-summary-20261008`；分类：内容 / Content。

1. 原虫洞探索现称信号空间，原虫洞谜质现称信号谜质；玩家已有物品、坐标、研究进度和探索记录保留。常用探索操作位于地图右侧，低高度和手机窗口的操作布局已改善。
2. 玩家累计获得100点协会声望后可从市场进入黑市。每日最多九种稀有商品，包含部分普通市场只收不卖的物资；商品按设备本地午夜换新，售罄后当天不补货。
3. 黑市新上架的无人机成品按50架一组出售，每个型号每日最多一组，整组购买。单架报价仍按基础价的30～100倍计算，整组无额外折扣；已生成的当日货架保持原数量和报价，下次刷新后使用组货。
4. 黑市可出现动能、爆破、能量三种MK3弹药的永久生产线蓝图，基础价为对应MK2图纸的19倍，再按黑市倍率报价。学习后可在组装机制造，配方不消耗虚空晶；蓝图不支持转售，制造的弹药可在市场出售。
5. 市场提供少量虚空晶应急供应，NPC挂售总量最多3000枚，库存不足时每6分钟补回1枚，补满后停止；刷新、读档和切换空间站不重置库存。虚空母矿继续只收不卖。

Title: Exploration and Market Notes

1. The original Wormhole exploration is now called Signal Space, and Wormhole Enigma is now Signal Enigma. Players retain their items, coordinates, research and exploration records. Common exploration controls sit to the right of the map, with improved layouts for short and mobile windows.
2. Players with 100 total earned Association standing can enter the Black Market from the Market. Up to nine rare goods appear daily, including selected goods unavailable from normal sellers. Stock refreshes at the device's local midnight, and sold-out offers do not restock that day.
3. Newly stocked finished drones are sold in groups of 50, with at most one group per model each day. Purchases cover the whole group. Per-drone pricing remains 30–100 times the base price, with no additional group discount. Existing daily offers keep their quantities and quotes until the next refresh.
4. The Black Market can offer permanent production blueprints for Kinetic, Explosive and Energy Ammo MK3. Their base prices are 19 times those of the corresponding MK2 blueprints, before the black-market markup. Learned blueprints enable manufacturing in the Assembler without Void Crystals. Blueprints cannot be resold; manufactured ammunition can be sold on the market.
5. The Market provides limited emergency Void Crystal supply, with up to 3,000 units in NPC sale stock. Below the cap, stock replenishes by one unit every six minutes and stops when full. Refreshing, loading a save or changing stations does not reset it. Void Mother Ore remains buyback-only.

## 四、旧内容可选补告

以下两张不属于本轮新增；仍待船长决定是否补发，不用九张旧卡反复弹窗。

### A. 舰船拆解回收

建议ID：`ann-ship-scrap-summary-20261008`；分类：系统 / System。

1. 玩家可在装配页舰船插件区域使用拆解回收，将非驾驶、未被占用的舰船拆成制造料单50%的材料，各项向下取整。
2. 回收需两次确认，确认窗口列出返还材料与数量；蓝图书不会返还，拆解后舰船从舰队移除。
3. 高、中、低槽装备与普通舰船插件退回装备库，无人机与货舱货物返还库存；战损插件不作为可回收物品。

Title: Ship Scrapping

1. Players can use the scrapping command in the Fitting page's ship plug area to dismantle an unoccupied ship that is not currently being piloted. It returns 50% of each material in the manufacturing bill, rounded down.
2. Scrapping requires two confirmations, with returned materials and quantities listed before completion. Blueprint books are not returned, and the dismantled ship is removed from the fleet.
3. High-, mid- and low-rack modules and normal ship plugs return to the module bay. Drones and cargo return to inventory. Damage plugs are not recoverable items.

### B. 无人机保障与鲸王级补充说明

建议ID：`ann-drone-whale-summary-20261008`；分类：内容 / Content。

1. 高槽无人机储备甲板可用备用同型无人机补回战损机体，MK1、MK2、MK3基础周期为14、12、9秒。备用机来自允许的战斗补给库存，不是无人机舱中已出战的架数；实际周期受本舰装填代价影响。
2. 中槽无人机护盾投射仪MK2、MK3分别为机群护盾容量增加70%、100%，不增加装甲或结构，多件效果相加。
3. 鲸王级采矿艇现有装配位为4高、3中、3低，CPU为230，跃迁速度为3.5AU/s；已拥有的舰船同样使用这些属性。

Title: Drone Support and Whaleking-class Notes

1. High-rack Drone Reserve Decks replace destroyed drones using spare drones of the same model. MK1, MK2 and MK3 have base cycles of 14, 12 and 9 seconds. Spares come from eligible battle supplies, not drones already deployed from the bay. Actual cycles are affected by the carrier's reload penalties.
2. Mid-rack Drone Shield Projector MK2 and MK3 increase drone shield capacity by 70% and 100%, respectively. Armor and hull are unchanged, and multiple projectors add their bonuses.
3. The Whaleking-class Mining Corvette has 4 high, 3 mid and 3 low fitting slots, 230 CPU and a warp speed of 3.5 AU/s. Ships players already own use these attributes as well.

## 五、事实核对与发布边界

- 排期与主动入侵池：`weekendEvent.ts`的已完成势力为R/C/H、10-09指定C，主动发射器同池随机。不要写成所有入侵都强制C，也不追改已经开启的光环补场。
- 腐蚀：`alienCombat.ts`与`acid-burst-stacking-fx-20261007.md`确认逐次15个百分点、装甲/结构、跨波保留、战后清除；最低抗性沿既有规则，不把视觉扩散称范围伤害。
- 玩家回收：`shipWrecks.ts`基础25%、技能5/4百分点、装备80/4百分点；仅两条舰体技能练满为70%，不是90%。90%为与既有加固件合算的上限，本稿不以“技能满级90%”误导。
- 新残骸装备逐件一次，旧残骸不强制改成新判定；无人机按原独立规则。本稿不承诺每架无人机80%或100%，也不把敌方“完好舰体装备发现”称为获得一艘船。
- 战损：`shipDamage.ts`50%新增、15%单项、最多3类，普通槽数不变；`plugBlockReasonOf`禁止带战损船入仓／挂售。后续舰队隐藏普通插件已覆盖早期三页统一展示描述。
- 力场、8%装填、多件负面、34张一次性舰船蓝图与皇带鱼停售，以现行源码及最新三份工作记录为准；皇带鱼旧记录“仍3.2亿”已被10%舰价的新6400万覆盖。
- 收购：48件势力/信号空间模块倍率1→0.25，另5件通用基础收购200万；不是全商品降价，不调整专属无人机或玩家已有成交收入，不保证所有行情报价等于基础价。
- 战斗：新战斗首轮装填、在途和换波不重置；逐炮是已上线规则，不再照旧稿声称装填规则全部未改。捕获网为显示和异常修复，不调巢母基础240m/s。
- 准备：core记忆五类，但新虫洞两类不公开；玩家公告只列信号空间手动/自动与入侵旗舰三类。
- 市场补告：黑市、MK3、虚空晶、信号空间和逐炮已位于`origin/main`，不是49个未推送提交带来的全新系统。老稿“不推送”只是当时记录，不作为当前事实。
- 待审内容不删除源稿、不修改已发正文；批准总稿后再把旧稿标为被取代或按归档规则清理，避免留下两份均可发布的版本。

## 六、暂不公告

- 明确不发的历史项目：技能训练许可、黑市首次访问通讯、早期虫洞战利品等，不因本次检索重新挂账。
- 已有正式公告：货舰与海牛、光环科技、补偿、实验室、技能扩展、战列舰、原矿经济、历史残骸归组等，不重复发布或改写旧价格。
- 试做入侵标签：待船长观感裁定，可在确认后并入第6张第3条，不单独新增公告。
- 星系搜索、动态星图、星球建设、深空探测机、未来新虫洞：入口未对普通玩家开放，不做上线承诺。
- CPU插件增强与其他尚未确认提案、未合入改动：不当成已实施内容。
- 推进器点火/冲锋表现、舰队普通插件隐藏、导弹提示等小改已按主题择要合并，不另发零碎公告。

## 七、检查方式

本轮是公告审校与事实核对，不修改业务。核对了主树49个待推送提交的文件差异、完整公告表、当前排期与概率常量、价格/战损/装配规则及对应测试说明。保留既有真实存档和未跟踪导出文件；不运行个人存档复现，不将过往测试数字当作本轮重新执行结果。

发布前仍需：船长审核正文 → 核对实际发布日及10-09排期 → 分配唯一中英词条并入公告表 → 技术检查和合入 → 按船长明确指令推送。此次请求不等于批准发布或推送。
