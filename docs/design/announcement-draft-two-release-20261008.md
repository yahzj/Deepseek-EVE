# 待发公告两篇整合稿

> **状态：待船长审核；仅合并草稿，未写入正式公告表，未推送**（零号 · `dsh/system-search-20261007` · 2026-10-08）
> **船长原话**：「将公告合并成2个，一个是异形虫群入侵，另外一个是所有数据调整和新增机制，UI调整不算在内」。
> **范围／不做**：原总稿七篇及两篇补告候选合并为两篇，同步后续巢母、扩槽和光环改动；不修改游戏机制、历史公告、原来源稿或个人档，不公告未开放内容。
> **待裁决**：两篇正文；合并指令不等于逐字发布批准。正式日期按发布时核对，异形排期沿设备本地时间。

## 一、整合范围

- 核对主树 `8d6c6f0f`，原总稿核对基线为 `aa0ae11c`。当前公告表未新增这些待审公告；标题中的“待审”以正文和正式公告编号比对，不凭文件名判断。
- 本稿作为此次两篇版本的递审入口；原七篇总稿和各单篇只作来源，不并行发布，正文获批后再按规则整理来源状态。未批准前不删除历史来源。
- 异形原稿的复活工虫已被 `caac8bc9` 的成虫召唤取代。光环以 `421be0c0` 的全队射程、支援叠光和冷却内护盾为准，不照发旧常驻护盾或2秒宽限描述。
- 已正式公告的纯货舰与海牛、实验室、技能扩展、战列舰及历史原矿经济等不重复发布；黑市货架、MK3弹药、信号空间改名等已上线但未公告的内容可在综合篇补充，不写成“本次才开放”。
- 星系种子搜索、动态星图、深空探测机、星球建设和未来虫洞不对普通玩家开放，不进正文。数据编辑器、钩子、工具、测试档和重构不进玩家公告。
- 本稿只改文档与生成索引，不重跑战斗或读取存档；以下数字来自现行实现与已合入专项，不冒称公告整理本身重新验证了业务。

## 二、公告一：异形虫群入侵

- 建议编号：`ann-alien-invasion-20261007`
- 标题：异形虫群入侵
- 分类：内容
- 日期：2026-10-08，正式发布时复核

### 中文正文

1. 玩家将在10月9日20:00开始的入侵中迎战异形虫群，活动时间按设备本地时间计算。常规入侵势力按光环科技、异形生物、墨潮帮轮换；信号发射器也可能召来异形入侵。
2. 酸液爆虫会贴近爆发并自毁，近距离被击杀时也会爆发。每次爆发使玩家编队的装甲、结构抗性再降低15个百分点，可降至负值；腐蚀在本场战斗内跨波保留，不影响护盾和无人机。
3. 哺育工虫能够修复同伴，但不能修复巢母的旗舰共享血池。背巢巨兽与巢母巨兽以颚钳虫群为主要火力：背巢每12秒补回战损虫群，每艘后备32架；巢母每9秒补回战损虫群，后备无限。补机只恢复本波存活舰船的损失机位，不为活机回血。
4. 巢母每30秒召唤最多3架星髓成虫，与原单位一起计入本波4艘编队上限；空位不足只补空位，满编时跳过，不积攒次数。成虫沿用旗舰部队原成虫的强度，不继承巢母厚血或旗舰共享血池。巢母存活时，全队速度每秒增加1.5个百分点，120秒达到+180%；巢母被击毁后，补机、召唤和速度加成均停止。
5. 玩家可打捞异形入侵的普通、稀有残骸。稀有残骸用回收炉解体有机会获得生体甲壳板、生体损管腔和酸液喷吐器；玩家亲手击沉巢母可获得异形旗舰黑匣，用于制造舰船插件。

### English

Title: Alien Swarm Incursion

Tag: Content

1. Players will face alien swarms in the incursion starting at 20:00 on October 9, using the device's local time. Regular incursions rotate through Corona Systems, Alien Lifeforms and the Ink Tide Gang. Signal Emitters can also summon alien incursions.
2. Acid Bursters close in, burst and self-destruct, and also burst when destroyed at close range. Each burst reduces the player's fleet armor and hull resistances by another 15 percentage points, allowing negative resistance. Corrosion persists across waves within the battle and does not affect shields or drones.
3. Brood Workers repair their allies, but cannot repair the Broodmother's shared flagship health pool. Hiveback and Broodmother Behemoths rely on Jawclaw Swarms for most of their firepower. Hivebacks replace lost swarm units every 12 seconds, with 32 reserves per carrier; Broodmothers replace them every 9 seconds with unlimited reserves. Replacement restores lost drone slots on surviving ships in the current wave and does not heal surviving drones.
4. A Broodmother summons up to three Starcore Adults every 30 seconds. They share this wave's four-ship formation limit with the original units. Only vacant places are filled; full formations skip the cycle without accumulating summons. Adults use the strength of the flagship force's original Adults, without inheriting the Broodmother's extra health or shared flagship health pool. While the Broodmother is alive, fleet speed increases by 1.5 percentage points each second, reaching +180% after 120 seconds. Drone replacement, summoning and the speed bonus end when it is destroyed.
5. Players can salvage ordinary and rare alien incursion wrecks. Recycling rare wrecks can yield Bio Carapace Plates, Bio Damage Control Chambers and Acid Sprayers. Players who personally destroy the Broodmother receive an Alien Flagship Black Box for manufacturing ship plugs.

## 三、公告二：数据调整与新增机制

- 建议编号：`ann-balance-mechanics-summary-20261008`
- 标题：数据调整与新增机制
- 分类：系统
- 日期：2026-10-08，正式发布时复核

### 中文正文

1. 舰船回收与装配：玩家可打捞正常星系中的沉船尝试整船回收，基础成功率25%，回收舰船拖回母港，装甲与结构各保留20%。工程新增舰体打捞工程学、高级舰体打捞工程学、装备保全工程学；两项舰体技能每级分别增加5、4个百分点回收率，彼此加算。成功回收时普通装备基础保全率80%，装备保全技能每级增加4个百分点，满级100%；新产生残骸的普通装备逐件判定一次，未保全的装备永久损失，无法重新装载的保全装备退库。无人机仍独立判定，货舱货物与预载弹药不返还，信号空间不生成此类沉船残骸。回收成功后有50%概率新增战损插件，随机一项属性降低15%，同类不重复、最多三个；战损不占普通插件槽，常规维修不清除，带战损舰船不能入仓或挂售。普通插件可重复安装，中槽扩展与低槽扩展各限一件、可同时安装，已有同类型多余件及缩减槽位上的装备免费退库，超量无人机退回物品仓库。玩家可把沉船装配保存为对应船型的方案，插件仅作参考、不自动安装；主动拆船回收可返还制造料单50%的材料，装备、普通插件、无人机与货物返库，蓝图不返还。
2. 战斗与装备：玩家与敌舰齐射按每门武器分别判定命中，敌舰齐射总伤害不因炮数增加，激光仍必中。新战斗中玩家武器和无人机先完成一轮实际装填再开火，正在进行的战斗与换波不重置装填；修复保存重载后敌方近防失效及捕获网减速异常。护盾充能力场MK2、MK3只恢复其他存活队友，每次有效发动消耗装载舰最大护盾的10%，不按队友人数多扣；自身护盾不足或无人需要恢复时不发动、不扣盾，不同型号独立触发，基础周期仍为10秒、8秒，同舰多装恢复量递减。巨构协处理器每件仍增加90 CPU，装填代价由12%降至8%，多件相乘，并影响本舰武器、无人机及战斗主动装置周期，不改变推进器点火、冷却或采矿、打捞周期。装备的速度、射程、命中代价逐件相乘，抗性代价逐件减去百分点；有多装递减的装备，负面效果也随该件收益递减。无人机储备甲板MK1、MK2、MK3基础补机周期为14、12、9秒，护盾投射仪MK2、MK3分别增加机群护盾70%、100%。鲸王级采矿艇现有4高、3中、3低槽，CPU230，跃迁速度3.5AU/s。
3. 光环敌舰：光环中枢每60秒检查编队空位，有空位时召唤一艘满血叠光级，满编跳过、不积攒次数，中枢被击毁后停止。聚焦阵列在本波120秒内增强，全队最远射程最高增加200%，中枢自身武器消除远端衰减、近防伤害最高增加200%；随波重置，中枢被击毁后全队射程加成失效。射程修正与玩家电子压制加算抵消。叠光级基础装填为4.5秒，每次攻击或闪现缩短0.4秒，最低0.5秒；新召唤叠光级从基础装填开始。垂暮级在闪现冷却满1秒后获得护盾50%全伤害抗性，持续至本次冷却结束，冷却外不生效。
4. 市场、蓝图与残骸：黑市在玩家累计获得100点协会声望后开放，每日最多九种稀有商品，按设备本地午夜换新，售罄当天不补货，报价为基础价的30至100倍。新上架无人机成品按50架一组出售，已有当日货架数量和报价不变，刷新后使用组货。黑市可出现动能、爆破、能量三种MK3弹药永久生产线蓝图，基础价为对应MK2图纸的19倍，再按黑市倍率报价，制造不消耗虚空晶；蓝图不能转售，制造的弹药可以在市场出售。一次性舰船蓝图基础价由舰价50%降至10%，皇带鱼级一次性蓝图改为只收不卖，已有图纸的制造、出售和原掉落保留。势力与信号空间专属装备基础收购价降为原来的25%；护盾充能力场MK2、MK3、隐秘行动装置MK3、损伤管制装置MK3、跃迁计算机MK3基础收购价为200万信用点，实际报价随行情浮动，购买价不变。打捞中的完好舰体装备发现改为从民用、MK1与特色装备中随机获得；入侵和守墓者高安稀有残骸通用装备池扩充，信号空间稀有残骸未出专属时按MK2与MK3的1:0.25权重抽组。挂售中的专属装备计入持有量，未成交挂单不再触发优先补发。市场虚空晶应急库存最多3000枚，不足时每6分钟补1枚，刷新或读档不重置；虚空母矿仍只收不卖。已有物品、信用点、已锁定挂单报价与已结算掉落不追改。
5. 探索与入侵：原虫洞探索更名为信号空间，虫洞谜质更名为信号谜质，已有物品、坐标、研究进度和探索记录保留。入侵重复出击会在收复当前星系后自动切换，先外围、后核心，全部收复后停止，旗舰仍需玩家手动挑战；当前战斗与返航不会被中途改换或打断。修复旧残骸筛选使入侵普通残骸库存不扣减的问题，稀有轮仍不消耗普通池；已收复星系手动出击的残骸减半规则保留。自动探索队伍不包含主控舰时，不再被主控正在作业误挡。

### English

Title: Balance Changes and New Mechanics

Tag: System

1. Ship recovery and fitting: Players can attempt whole-ship recovery from wrecks in normal star systems, with a base chance of 25%. Recovered ships return to the home port with 20% armor and hull condition. Engineering gains Hull Salvage Engineering, Advanced Hull Salvage Engineering and Equipment Preservation Engineering. The hull skills add 5 and 4 percentage points of recovery chance per level, stacking additively. Successful recovery preserves ordinary equipment at a base chance of 80%; Equipment Preservation adds 4 percentage points per level, reaching 100% at maximum level. Ordinary equipment in newly created wrecks is rolled once per module; failed rolls lose the module permanently, while preserved modules that cannot be refitted return to storage. Drones are rolled separately, cargo and preloaded ammunition are not restored, and Signal Space does not leave these ship wrecks. Successful recovery has a 50% chance to add a damage plug reducing one random attribute by 15%, with no repeated type and at most three. Damage plugs do not consume normal plug slots and are not removed by ordinary repairs; damaged ships cannot be stored or listed for sale. Normal plugs can be installed repeatedly, but mid-slot and low-slot expansion each permit one plug and can coexist. Extra same-type expansion plugs and equipment displaced by reduced slots return to storage for free; excess drones return to the warehouse. Players can save a wreck's loadout as a fitting preset for its ship type; plugs remain references and are not installed automatically. Ship scrapping returns 50% of the manufacturing materials and returns equipment, normal plugs, drones and cargo to storage, but not blueprints.
2. Combat and equipment: Player and enemy salvos roll hits per weapon, without increasing enemy salvo damage through weapon count. Lasers retain guaranteed hits. In new battles, player weapons and drones complete one actual reload cycle before firing; existing battles and wave transitions do not reset reloads. Enemy point-defense failures after reloading a save and incorrect capture-web slowdown are fixed. Shield Charge Field MK2 and MK3 restore only other surviving allies. Each effective activation consumes 10% of the carrier's maximum shield capacity, regardless of the number of allies. Insufficient carrier shield or no ally needing restoration means no activation or shield cost. Different models trigger independently, retaining base cycles of 10 and 8 seconds and diminishing restoration from multiple fields on one ship. Each Megastructure Coprocessor still adds 90 CPU, with its reload penalty reduced from 12% to 8%, multiplying across modules and affecting the carrier's weapons, drones and active combat-device cycles. Thruster boost duration and cooldown, mining and salvaging cycles are unchanged. Speed, range and accuracy penalties multiply across modules; resistance penalties subtract percentage points. Where equipment has diminishing returns, its penalties follow the benefit of the same module. Drone Reserve Deck MK1, MK2 and MK3 have base replacement cycles of 14, 12 and 9 seconds. Drone Shield Projector MK2 and MK3 add 70% and 100% drone shield capacity. The Whaleking-class Mining Corvette has 4 high, 3 mid and 3 low slots, 230 CPU and a warp speed of 3.5 AU/s.
3. Corona enemies: The Corona Nexus checks formation vacancies every 60 seconds and summons one Corona Overlay at full health if there is room. Full formations skip the cycle without accumulating summons; reinforcements stop when the Nexus is destroyed. The Focus Array strengthens over 120 seconds of the current wave, granting the fleet up to +200% maximum range, while the Nexus's own weapons lose their falloff and its point-defense damage gains up to +200%. It resets each wave, and the fleet range bonus ends when the Nexus is destroyed. Range bonuses and player electronic suppression offset additively. Corona Overlay starts with a 4.5-second reload, reduced by 0.4 seconds after each attack or blink, down to 0.5 seconds. Newly summoned Overlays start at the base reload. Corona Dusk gains 50% shield resistance to all damage once blink has been on cooldown for one second, lasting until that cooldown ends; it is inactive outside cooldown.
4. Markets, blueprints and wrecks: The Black Market opens at 100 total earned Association standing and offers up to nine rare goods daily. Stock refreshes at the device's local midnight, sold-out offers do not restock that day, and prices are 30 to 100 times the base price. Newly stocked finished drones are sold in groups of 50; existing daily offers retain their quantities and prices until the next refresh. The Black Market can offer permanent production blueprints for Kinetic, Explosive and Energy Ammo MK3, with base prices 19 times those of the corresponding MK2 blueprints before the black-market markup. Manufacturing requires no Void Crystals. Blueprints cannot be resold; manufactured ammunition can be sold on the market. Single-use ship blueprint base prices fall from 50% to 10% of the ship's base price. The Oarfish-class single-use blueprint becomes buyback-only, retaining existing copies' use, sale and drop sources. Base buyback prices for faction-exclusive and Signal Space-exclusive equipment fall to 25% of previous values. Shield Charge Field MK2 and MK3, Stealth Module MK3, Damage Control Unit MK3 and Warp Computer MK3 have base buyback prices of 2 million credits; quotes fluctuate with the market and purchase prices are unchanged. Intact-hull equipment finds during salvaging draw randomly from civilian, MK1 and themed equipment pools. Standard equipment pools for rare incursion and high-security Gravekeeper wrecks are expanded; rare Signal Space wrecks without exclusive loot draw from MK2 and MK3 groups at weights of 1 and 0.25. Exclusive equipment in pending sale listings counts as owned and no longer triggers priority replacement. Emergency Void Crystal stock is capped at 3,000 units, replenishing one every six minutes below the cap without resets on refresh or save loading. Void Mother Ore remains buyback-only. Existing items, credits, locked listing quotes and previous drops are unchanged.
5. Exploration and incursions: The original Wormhole exploration is now Signal Space, and Wormhole Enigma is now Signal Enigma. Existing items, coordinates, research and exploration records are retained. Repeat assault switches targets after reclaiming the current system, clearing the periphery before the core, and stops once all systems are reclaimed. Flagships still require a manual challenge; current battles and return trips are not retargeted or interrupted. Old wreck filters no longer bypass deductions from ordinary incursion wreck stock, while rare-wreck rounds still do not consume ordinary stock. Manual sorties in reclaimed systems retain their half-wreck yield. Automatic exploration squads without the player-controlled ship are no longer incorrectly blocked by that ship's ongoing work.

## 四、来源覆盖与剔除

| 来源／内容 | 两篇处置 |
|---|---|
| 原总稿第1篇、异形独立稿、巢母召唤后续 | 公告一全部覆盖，替换工虫复活，去掉特效一条 |
| 原总稿第2篇，整船回收／工程／战损／普通重复插件／沉船方案 | 公告二第1条；富详情、舰队警告等界面描述删除 |
| 同类型扩槽限装与免费退件 | 公告二第1条，保留中低可并存和资产返还 |
| 原总稿附录A拆船回收 | 公告二第1条，去掉按钮、确认窗等界面细节 |
| 原总稿第3篇护盾力场／装备负面／巨构装填 | 公告二第2条；一次性舰船蓝图移至第4条 |
| 原总稿附录B无人机保障及鲸王数值 | 公告二第2条按现行数值补告 |
| 原总稿第5篇新战斗首轮／逐炮、近防续战修复 | 公告二第2条；武器列表、周期面板、连线、名称染色与手册显示均不纳入 |
| 光环中枢增援与新护盾窗口，此前聚焦／叠光数据调整 | 公告二第3条按最新主树，不回改旧已发布公告 |
| 原总稿第4篇残骸池／收购／挂单持有 | 公告二第4条；普通入侵池扣量修复移第5条 |
| 原总稿第7篇黑市／MK3／虚空晶 | 公告二第4条；商人动画、卡片与导航描述删除 |
| 原总稿第7篇及信号空间独立稿 | 公告二第5条只保留内容改名和已有进度保留，删除操作栏及屏幕适配 |
| 原总稿第6篇重复出击路线与主控误拦 | 公告二第5条，删除活动栏、冷却显示及阵容记忆等界面描述 |
| 原总稿第6篇可选既有60/40贡献与常驻赏金规则 | 属已存在规则而非数据调整或新增机制，不另占篇幅、不误宣称新改动 |
| 墨潮手册漏挂载与实际两艘说明 | 仅显示／说明修正，墨潮机制未改，按船长排除界面要求不纳入 |
| 已正式公告／明确不发／尚未开放 | 不重复发布、不改历史、不承诺上线 |

## 五、事实与发布核对

- 巢母：本波4艘上限含巢母及其它存活单位，不是“额外3架无限叠加”；30秒只补空位，旧原生第二波成虫基准936血量，无共享血池继承。背巢／巢母补损并非复活死亡舰船。
- 玩家回收：基础25%，两项舰体技能满级合计为70%；与既有加固件合算上限90%。公告不写“满技能90%”。装备满级100%仅限成功整船回收时普通装备，不承诺无人机100%。新装备判定一次，历史残骸沿原规则，不追改掉落。
- 负面叠加：抗性按百分点减，不写乘算；巨构装填不改变推进器点火与冷却、采矿或打捞周期。护盾力场实际周期受装填代价影响，正文仅写基础周期。
- 光环：聚焦射程全队，衰减与近防增伤仅中枢自身；垂暮只在冷却内满1秒后生效，旧2秒延续已替换。原稿四件说明中的UI部分不纳入。
- 价格：专属模块基础收购价25%不是全商品买价25%；通用5件基础收购200万不保证行情等于200万。一次性舰船图纸10%是舰价10%，不是旧图纸价再乘10%。MK3黑市图纸19倍再受30至100倍黑市倍率，未把最终售价写成19倍。
- UI排除不删除业务：沉船保存方案为新增操作能力，保留；富卡、染色、横滚换行、手机、战斗射程面板等均不纳入。信号空间改名属内容名称变更，保留，但不涉及新虫洞开放。
- 正文按现有公告要求各5条，以主题合并。本稿信息较多，按主题分段阅读，不在代码新增第三张公告或新界面；压缩不能删掉重要削弱、概率和免费退件。
- 实际发布前再次核对10月9日排期及发布日；得到两篇正文的明确批准后，才分配唯一双语词条、写正式公告表并执行检查。推送仍需船长明确指令。
