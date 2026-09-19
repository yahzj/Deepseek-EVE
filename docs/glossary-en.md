# 英文术语与专名译名表（English Glossary & Naming Table）

状态：**P0 已冻结**（2026-09-19 立 · 船长五问五答裁决完毕，见 §七）· P0b 专名补齐中
权威范围：**游戏内可见文案的英文口径**（界面 / 内容数据 / 说明）。开发侧文档、注释、汇报仍用中文（`AGENTS.md` §1）。
工作文档：`docs/design/l10n-en-20260919.md`。冻结后本表是唯一译名来源；后续批次（P2 内容 / P3 界面）一律按本表出稿。

> 怎么用：本表分「命名规则 → 机制与 UI 术语 → 单位与格式 → 专名表（舰船 / 星系 / 矿带 / 势力）」。
> 审阅时**只需改你不同意的行**；标 ⚠ 的是我拿不准、点名请你裁决的。冻结后我按表批量出稿，改表即改全部。

---

## 一、命名规则（直译口径，2026-09-19 船长定）

1. **直译优先，保留中文名的意象**：长尾鲨级 → `Thresher-class` · 钛钢合金 → `Tritanium Alloy` · 鲣鱼级 → `Skipjack-class`。
   不做英文重命名、不加英文风味词。
2. **舰级后缀按中文量词直译**：艇 → `Corvette` · 舰 → `Frigate / Destroyer / Cruiser / Battleship`（按中文名里的实际级别）·
   旗舰 → `Flagship` · 货舰 → `Freighter` · 母舰 → `Carrier` · 炮舰 → `Gunboat`。
3. **档位与型号照抄**：`MK1 / MK2 / MK3` 原样保留；舰体档 `T3 / T4 / T5` → `Tier 3 / Tier 4 / Tier 5`（表格里可写 `T3`）。
4. **族系前缀照译**：掠袭 → `Raider` · 亡军 → `Deadarmy` · 陵卫/陵寝 → `Tombwarden / Mausoleum` · 巢群 → `Hiveswarm` ·
   构件 → `Construct` · 幽影 → `Wraith` · 哨戒 → `Sentry` · 幼虫 → `Larva` · 甲壳 → `Carapace`。
5. **中文神话/自造专名**：意译优先，意译会失真时保留拼音（`Xuanwu-class`）＋ 表内加注。
6. **标点与空格**：中文的 `·` 在英文里写 ` · `（空格中点，保留）· 括号用半角 `()` · 不用中文全角标点 ·
   数字与单位之间加空格（`3,220 m` · `1,000 m³` · `70,000 ISK`）。
7. **界面术语一律统一**（下表冻结）：例如「拆解」= `Unbox`（货柜专用）、「解体 / 回收」= `Salvage`（残骸专用）——
   与中文侧「货柜=拆解 / 残骸=解体·回收」的同一条口径对齐。
8. **不写原因解释**这条中文文案硬规矩**同样适用于英文**（括号只许放规格）。

## 二、机制与 UI 术语表

| 中文 | English | 备注 |
|---|---|---|
| 星图 | Star Map | 一级页 |
| 舰船 | Ships | 一级页 |
| 装配 | Fitting | 一级页 |
| 物品 | Items | 一级页 |
| 市场 | Market | 一级页 |
| 工业 | Industry | 一级页 |
| 技能 | Skills | 一级页 |
| 通讯 | Comms | 面板 |
| 手册 | Handbook | 面板 |
| 货舱 | Cargo Hold | |
| 物品仓库 | Warehouse | |
| 装备库 | Module Storage | |
| 蓝图书架 | Blueprint Library | |
| 装配方案 | Fitting Preset | |
| 高槽 / 中槽 / 低槽 | High / Mid / Low Slot | |
| 无人机 | Drone | |
| 无人机舱 | Drone Bay | |
| 护盾 / 装甲 / 结构 | Shield / Armor / Hull | 三层承伤 |
| 抗性 | Resistance | |
| 回避率 | Evasion | |
| 命中率 | Hit Rate | 2026-09-19 新增属性行 |
| 命中加成 | Hit Bonus | 加算项 |
| 推进失稳 | Thruster Instability | 点火期惩罚 |
| 索敌阵列 | Tracking Array | 中槽命中件 |
| 火控 | Fire Control | |
| 动能 / 高爆 / 能量 | Kinetic / Explosive / Energy | 三系 |
| 克制系数 | Damage Type Multiplier | |
| 异常点 | Anomaly | |
| 悬赏 | Bounty | |
| 虫洞 | Wormhole | |
| 遗迹 | Ruins | |
| 舰船墓场 | Graveyard | |
| 矿脉 | Ore Vein | |
| 漂浮信标 | Drifting Beacon | |
| 打捞 | Salvage | |
| 精炼 | Refine | |
| 回收 / 解体 | Reprocessing / Salvage | 残骸专用 |
| 拆解 | Unbox | **货柜专用** |
| 全损 | Total Loss | 虫洞失败 |
| 撤离 | Extraction | |
| 战力 / 威胁 | Threat | |
| 僚机 | Escort | |
| 机群 | Drone Swarm | |
| 波次 | Wave | |
| 增援 | Reinforcements | |
| 支援呼叫 | Support Call | |
| 时序核心 | Chrono Core | |
| 谜质 / 谜质装置 | Enigma / Enigma Device | ⚠ 见待裁决 ② |
| 信用点 | credit / credits | 英文侧**不用 ISK**（船长 2026-09-19 裁决）；中文侧仍写「信用点」 |
| 离线结算 | Offline Settlement | |
| 自动作业 | Auto Operations | |
| 重复清剿 | Repeat Sweep | |
| 技能训练 | Skill Training | |
| 挂单 | Listing | 市场 |
| 供应簿 | Order Book | 市场 |
| 残骸 | Wreck | |
| 蓝图 / 图纸 | Blueprint | 一次性图纸 = `Single-use Blueprint` |
| 碎片 | Fragment | |
| 逆向解锁 | Reverse-engineer | |
| 稀有残骸 | Rare Wreck | |
| 密封货柜 | Sealed Container | 遗迹安全货柜的通称 |

## 三、单位与格式

| 中文 | English | 备注 |
|---|---|---|
| 信用点数额 | `476,945,470 credits`（=1 时写 `1 credit`） | 千分位用 `,`（`en-US`）；**不写 ISK** |
| m³ | `1,000 m³` | 不变 |
| km / m | `3,220 m` · `12 km` | 数字与单位间空格 |
| AU/s | `3.00 AU/s` | 不变 |
| 秒 / 分 / 小时 | `s` / `min` / `h`（行内）· `seconds / minutes / hours`（句子里） | |
| MK2 / MK3 | `MK2` / `MK3` | 原样 |
| 上限 90% | `cap 90%` | 抗性上限 |
| ×10 / ×0.85 | `×10` / `×0.85` | 乘号保留 |

## 四、专名表 · 舰船（43）

| id | 中文 | English |
|---|---|---|
| sandcat | 沙猫级采矿艇 | `Sandcat-class Mining Corvette` |
| burrower | 掘洞级采矿艇 | `Burrower-class Mining Corvette` |
| whale | 鲸吞级采矿艇 | `Whaleswallow-class Mining Corvette` |
| pioneer | 开拓级采矿艇 | `Pioneer-class Mining Corvette` |
| whale-king | 鲸王级采矿艇 | `Whaleking-class Mining Corvette` |
| sh-humpback | 座头鲸级矿舰 | `Humpback-class Mining Ship` |
| sh-bowhead | 蝠鲼级重载货舰 | `Manta-class Heavy Freighter` |
| sh-colossal | 皇带鱼级旗舰货舰 | `Oarfish-class Flagship Freighter` |
| sh-falconet | 鲣鱼级护卫舰 | `Skipjack-class Frigate` |
| sh-shrike | 马鲛级护卫舰 | `Mackerel-class Frigate` |
| sh-tigershark | 虎鲨级武装护卫舰 | `Tigershark-class Armed Frigate` |
| sh-mako | 灰鲭鲨级驱逐舰 | `Mako-class Destroyer` |
| sh-whiteshark | 大白鲨级炮舰 | `Whiteshark-class Gunboat` |
| sh-swarm | 梭鱼级无人机护卫 | `Barracuda-class Drone Frigate` |
| sh-sentinel | 王鲭级无人机母舰 | `Kingfish-class Drone Carrier` |
| sh-thresher | 长尾鲨级导弹巡洋舰 | `Thresher-class Missile Cruiser` |
| sh-electricray | 电鳐级激光巡洋舰 | `Electricray-class Laser Cruiser` |
| sh-hammerhead | 锤头鲨级炮击巡洋舰 | `Hammerhead-class Gunnery Cruiser` |
| sh-bullshark | 牛鲨级突击巡洋舰 | `Bullshark-class Assault Cruiser` |
| sh-nautilus | 鹦鹉螺级测绘巡洋舰 | `Nautilus-class Survey Cruiser` |
| sh-tortoise | 陆龟级重装艇 | `Tortoise-class Heavy Corvette` |
| sh-hawksbill | 玳瑁级重装巡舰 | `Hawksbill-class Heavy Cruiser` |
| sh-xuanwu | 玄武级重装旗舰 | `Leatherback-class Heavy Flagship` | 棱皮龟（海龟里最大的一型，船长 2026-09-19 裁决） |
| sh-megalodon | 巨齿鲨级战列舰 | `Megalodon-class Battleship` |
| sh-dunkleosteus | 邓氏鱼级旗舰 | `Dunkleosteus-class Flagship` |
| sh-flyingfish | 飞鱼级快运舰 | `Flyingfish-class Courier` |
| sh-sailfish | 旗鱼级高速货舰 | `Sailfish-class Fast Freighter` |
| sh-swordfish | 剑鱼级大型货舰 | `Swordfish-class Heavy Freighter` |
| sh-wh-a-frigate | 掠袭电子舰 | `Raider EW Frigate` |
| sh-wh-a-destroyer | 掠袭炮舰 | `Raider Gunboat` |
| sh-wh-a-cruiser | 掠袭重型突击巡洋舰 | `Raider Heavy Assault Cruiser` |
| sh-wh-c-frigate | 幼虫截击舰 | `Larva Interceptor` |
| sh-wh-c-destroyer | 甲壳截击舰 | `Carapace Interceptor` |
| sh-wh-c-cruiser | 巢群重型突击巡洋舰 | `Hiveswarm Heavy Assault Cruiser` |
| sh-wh-d-frigate | 哨戒电子舰 | `Sentry EW Frigate` |
| sh-wh-d-destroyer | 陵卫指挥舰 | `Tombwarden Command Ship` |
| sh-wh-d-cruiser | 陵寝巡洋舰 | `Mausoleum Cruiser` |
| sh-wh-e-frigate | 构件鱼雷舰 | `Construct Torpedo Frigate` |
| sh-wh-e-destroyer | 机库无人机作战舰 | `Hangar Drone Combat Ship` |
| sh-wh-e-carrier | 巨构无人机作战舰 | `Megastructure Drone Combat Ship` |
| sh-wh-g-frigate | 幽影侦察舰 | `Wraith Scout Frigate` |
| sh-wh-g-destroyer | 亡军后勤舰 | `Deadarmy Logistics Ship` |
| sh-wh-g-cruiser | 亡军鱼雷舰 | `Deadarmy Torpedo Cruiser` |

> 虫洞族舰（`sh-wh-*`）中文名里**没有「级」字**（它们是敌舰模板名）⇒ 英文同样不加 `-class`。

## 五、专名表 · 星系（20）与矿带（17）

| id | 中文星系 | English | 中文矿带 | English |
|---|---|---|---|---|
| galaxy-hub | 大鲸鱼Ⅳ | `Leviathan IV` | 丰饶之环 | `Ring of Plenty` |
| galaxy-kor | 柯尔边境 | `Kor Frontier` | 灼烧裂隙 | `Scorched Rift` |
| galaxy-dust | 星尘荒原 | `Stardust Wastes` | 深空晶体带 | `Deepspace Crystal Belt` |
| galaxy-redring | 红环航道 | `Redring Corridor` | 红环危机带 | `Redring Crisis Belt` |
| galaxy-grave | 暗星坟场 | `Darkstar Graveyard` | 磷光霾场 | `Phosphor Haze Field` |
| galaxy-abyss | 深渊之门 | `Abyss Gate` | 离子风暴云场 | `Ionstorm Cloud Field` |
| galaxy-auro | 奥罗荒环 | `Auro Waste Ring` | — | — |
| galaxy-starcore | 星髓迷宫 | `Starcore Labyrinth` | 星髓晶脉 | `Starcore Vein` |
| galaxy-harbor | 新港走廊 | `New Harbor Corridor` | — | — |
| galaxy-haze | 灰霾带 | `Hazebelt` | 辉云矿带 | `Glowcloud Belt` |
| galaxy-shard | 碎晶带 | `Shardbelt` | 曦晶带 | `Dawncrystal Belt` |
| galaxy-cinder | 烬火星区 | `Cinder Sector` | 蓝霜冰环 | `Bluefrost Ice Ring` |
| galaxy-echo | 回音荒区 | `Echo Wastes` | 寒髓冰环 | `Frostmarrow Ice Ring` |
| galaxy-lantern | 灯塔长廊 | `Lantern Passage` | 氖云气田 | `Neon Cloud Field` |
| galaxy-chasm | 裂谷深带 | `Chasm Deepbelt` | 玄晶深带 | `Voidcrystal Deepbelt` |
| galaxy-mirage | 蜃影星系 | `Mirage System` | 蜃影晶簇 | `Mirage Cluster` |
| galaxy-maw | 星噬之口 | `Star Maw` | 星幽矿脉 | `Starwraith Vein` |
| galaxy-vault | 穹顶墓园 | `Vault Necropolis` | 极光云场 | `Aurora Cloud Field` |
| galaxy-nadir | 天底静区 | `Nadir Quiet Zone` | — | — |
| galaxy-voidedge | 虚海边缘 | `Voidsea Edge` | 暗星冰环 | `Darkstar Ice Ring` |

## 六、专名表 · 势力与部门（13）

| id | 中文 | English | 备注 |
|---|---|---|---|
| dshi | 深空工业协会 | `Deep Space Industry Association` | 简称 `DSIA` |
| salvage-guild | 打捞队工会 | `Salvage Guild` | |
| archive | 信息库 | `The Archive` | |
| dept-nav-control | 航行管制 | `Nav Control` | |
| dept-infra | 基建部 | `Infrastructure Dept` | |
| dept-survey | 测绘处 | `Survey Office` | |
| dept-industry | 工业部 | `Industry Dept` | |
| dept-smelt | 冶炼组 | `Smelting Group` | |
| dept-training | 训练处 | `Training Office` | |
| dept-finance | 财务处 | `Finance Dept` | |
| dept-route-safety | 航线安全 | `Route Safety` | |
| dept-recall | 检索重启 | `Recall & Restart` | 船长 2026-09-19 认可；若要改名随时说 |
| dept-salvage-crew | 老陈一队 | `Chen's Crew No.1` | 船长 2026-09-19 认可 |

## 七、已裁决记录（2026-09-19 船长五问五答 · 冻结依据）

| # | 议题 | 裁决 |
|---|---|---|
| ① | 货币 | **`credit` / `credits`**（英文侧不用 ISK；中文侧仍写「信用点」）⇒ `content:check` 的禁用词契约**无需按语言分叉**（英文侧同样不出现 ISK/EVE/NPC） |
| ② | 谜质 / 谜质装置 | **`Enigma` / `Enigma Device`** |
| ③ | 玄武级 | **用某类大型海龟的英文** ⇒ 定为 `Leatherback-class`（棱皮龟，海龟中最大的一型，配「重装旗舰」） |
| ④ | 老陈一队 / 检索重启 | **`Chen's Crew No.1`** ✓ · `Recall & Restart` 沿用（船长认可；改名随时说） |
| ⑤ | 鲸吞级 | **`Whaleswallow-class`**（直译保留意象） |

## 八、专名表 · 物品（86）

| id | 中文 | English |
|---|---|---|
| ore-veldspar | 橄榄岩 | `Peridotite` |
| ore-scorched | 辉长岩 | `Gabbro` |
| ore-hemorphite | 赤环岩 | `Redring Ore` |
| ore-glowstone | 辉云岩 | `Glowcloud Ore` |
| ore-sunshard | 曦棱晶 | `Dawnshard Crystal` |
| ore-voidshard | 玄晶 | `Voidcrystal` |
| ore-nebulite | 星幽矿 | `Starwraith Ore` |
| ore-voidmother | 虚空母矿 | `Voidmother Ore` |
| min-tritanium | 钛钢合金 | `Tritanium Alloy` |
| min-pyerite | 银纹超金属 | `Silvervein Supermetal` |
| min-mexallon | 晶态胶体 | `Crystalline Colloid` |
| min-nocxium | 重钨合金 | `Heavy Tungsten Alloy` |
| min-isotope | 同位聚晶 | `Isotope Polycrystal` |
| min-starcore | 星髓晶 | `Starcore Crystal` |
| min-darkiron | 冥铁合金 | `Darkiron Alloy` |
| min-voidcrystal | 虚空晶 | `Void Crystal` |
| gas-neon | 氖云气 | `Neon Cloud Gas` |
| gas-phosphor | 磷光霾 | `Phosphor Haze` |
| gas-ionstorm | 离子风暴云 | `Ionstorm Cloud` |
| gas-aurora | 极光云 | `Aurora Cloud` |
| ice-frost | 蓝霜冰 | `Bluefrost Ice` |
| ice-marrow | 寒髓冰 | `Frostmarrow Ice` |
| ice-darkstar | 暗星冰 | `Darkstar Ice` |
| ammo-kinetic-l / -2 | 动能弹药 / MK2 | `Kinetic Ammo` / `Kinetic Ammo MK2` |
| ammo-explosive-l / -2 | 爆破弹药 / MK2 | `Explosive Ammo` / `Explosive Ammo MK2` |
| ammo-plasma-l / -2 | 能量弹药 / MK2 | `Energy Ammo` / `Energy Ammo MK2` |
| drone-scout | 蜂鸟侦察无人机 | `Hummingbird Scout Drone` |
| drone-assault | 赤鸢战斗无人机 | `Redkite Combat Drone` |
| drone-heavy | 猎鹰攻坚无人机 | `Falcon Siege Drone` |
| drone-sentry | 雷鸥哨戒无人机 | `Thundergull Sentry Drone` |
| drone-exile-bee | 鱿蜂无人机 | `Squidwasp Drone` |
| drone-wh-c-heavy | 巢卫攻坚无人机 | `Hiveguard Siege Drone` |
| drone-wh-e-sentry | 构件哨戒无人机 | `Construct Sentry Drone` |
| repairkit-civ | 民用修理组件 | `Civilian Repair Kit` |
| repairkit-mil | 军用修理组件 | `Military Repair Kit` |
| mat-surveyor | 深空测绘仪 | `Deepspace Surveyor` |
| mat-chrono | 时序核心 | `Chrono Core` |
| mat-crane | 打捞起重机 | `Salvage Crane` |
| mat-drill | 采集钻机 | `Mining Drill` |
| mat-nebula | 星云驱散器 | `Nebula Disperser` |
| mat-enricher | 母矿富集器 | `Voidmother Enricher` |
| mat-expander | 舱段扩展器 | `Hold Expander` |
| mat-suppressor | 压制力场 | `Suppression Field` |
| mat-boss-analyzer | 守卫解析仪 | `Guardian Analyzer` |
| mat-extract-cover | 撤离掩护器 | `Extraction Cover` |
| mat-shield-res | 护盾谐振片 | `Shield Resonance Plate` |
| mat-armor-res | 装甲强化片 | `Armor Reinforcement Plate` |
| mat-hull-res | 结构加固片 | `Hull Reinforcement Plate` |
| mat-tracker | 追踪阵列 | `Tracking Array` |
| mat-gyro | 陀螺稳定器 | `Gyro Stabilizer` |
| mat-jammer | 干扰发射器 | `Jammer Emitter` |
| mat-rangefinder | 射程扩展器 | `Rangefinder Extender` |
| mat-blindspot | 盲区压制器 | `Blindspot Suppressor` |
| mat-ammo-dmg | 弹药增效器 | `Ammo Enhancer` |
| mat-reload | 装填加速器 | `Reload Accelerator` |
| mat-volley | 齐射协调仪 | `Volley Coordinator` |
| mat-ammo-back | 弹药回收装置 | `Ammo Recovery Unit` |
| mat-drone-net | 机群回收网 | `Drone Recovery Net` |
| mat-field-repair | 战地维修单元 | `Field Repair Unit` |
| mat-wh-essence | 虫洞谜质 | `Wormhole Enigma` |
| box-relic-a | 遗迹安全货柜（海盗） | `Ruins Safe Container (Pirate)` |
| box-relic-c | 遗迹安全货柜（异形） | `Ruins Safe Container (Alien)` |
| box-relic-d | 遗迹安全货柜（守墓） | `Ruins Safe Container (Gravekeeper)` |
| box-relic-e | 遗迹安全货柜（巨构） | `Ruins Safe Container (Titan)` |
| box-relic-g | 遗迹安全货柜（亡军） | `Ruins Safe Container (Deadarmy)` |
| box-bp-shallow | 图纸货柜（浅层） | `Blueprint Container (Shallow)` |
| box-bp-mid | 图纸货柜（中层） | `Blueprint Container (Mid)` |
| box-bp-deep | 图纸货柜（深层） | `Blueprint Container (Deep)` |
| box-valuables | 贵重品货柜 | `Valuables Container` |
| box-military | 军用备货柜 | `Military Supply Container` |
| lux-1 | 星港陈酿 | `Starport Vintage` |
| lux-2 | 贵族香料 | `Noble Spice` |
| lux-3 | 失落艺术品 | `Lost Artwork` |
| lux-4 | 陈年雪茄 | `Aged Cigars` |
| lux-5 | 异域织物 | `Exotic Textiles` |
| lux-6 | 香木雕刻 | `Aromatic Wood Carving` |
| lux-7 | 宫廷乐谱 | `Court Sheet Music` |
| lux-8 | 古法香膏 | `Ancient Balm` |
| lux-9 | 星图真迹 | `Original Star Chart` |
| lux-10 | 王冠遗钻 | `Crown Diamond` |
| ai-core-gamma / beta / alpha | 伽马 / 贝塔 / 阿尔法 AI 核心 | `Gamma / Beta / Alpha AI Core` |

## 九、专名表 · 技能（79）

| id | 中文 | English |
|---|---|---|
| spaceship-command | 舰船操控学 | `Spaceship Command` |
| navigation | 导航学 | `Navigation` |
| warp-drive-operation | 跃迁引擎操控 | `Warp Drive Operation` |
| acceleration-control | 加速控制理论 | `Acceleration Control` |
| mining-frigate | 采集器入门学 | `Mining Frigate` |
| industrial-ops | 采矿舰操作 | `Industrial Ship Operations` |
| armed-ops | 武装舰操作 | `Armed Ship Operations` |
| armored-ops | 装甲舰操作 | `Armored Ship Operations` |
| vector-maneuvering | 矢量机动操作 | `Vector Maneuvering` |
| evasion-maneuvering | 规避机动学 | `Evasive Maneuvering` |
| targeting-integration | 索敌统合 | `Targeting Integration` |
| mining | 采矿技术 | `Mining` |
| deep-space-harvesting | 深空采集学 | `Deep Space Harvesting` |
| refining | 精炼学 | `Refining` |
| reprocessing | 高级回收处理 | `Reprocessing` |
| industry | 工业理论 | `Industry` |
| materials | 材料学 | `Materials` |
| industrial-automation | 产线节拍学 | `Production Cadence` |
| industrial-ai-cap-basic | 工业自动化基础 | `Industrial Automation Basics` |
| industrial-ai-cap | 工业自动化 | `Industrial Automation` |
| astro-geology | 星质地质学 | `Astrogeology` |
| deep-hole-blasting | 深井爆破学 | `Deep-hole Blasting` |
| rich-vein-prospecting | 富矿勘探学 | `Rich Vein Prospecting` |
| core-smelting | 炉心熔炼学 | `Core Smelting` |
| furnace-expansion | 炉膛扩容学 | `Furnace Expansion` |
| batch-production | 批量生产学 | `Batch Production` |
| component-standardization | 组件标准化 | `Component Standardization` |
| ai-servicing | 副船整备学 | `Auxiliary Ship Servicing` |
| offline-ops | 离线作业管理学 | `Offline Operations` |
| station-engineering | 建筑工程学 | `Station Engineering` |
| salvage-recycling | 残骸回收学 | `Salvage Recycling` |
| salvage-rigging | 打捞装置整备学 | `Salvage Rigging` |
| wreck-assaying | 残骸富集识别学 | `Wreck Assaying` |
| salvage-refining | 残骸提纯学 | `Salvage Refining` |
| gunnery | 炮术学 | `Gunnery` |
| kinetic-gunnery | 动能炮术 | `Kinetic Gunnery` |
| missile-launching | 导弹发射学 | `Missile Launching` |
| laser-cannon | 激光炮学 | `Laser Cannon` |
| fire-control | 火控阵列学 | `Fire Control` |
| reload-drills | 武器装填技术 | `Reload Drills` |
| drone-warfare | 无人机作战学 | `Drone Warfare` |
| ammunition-condensing | 弹药集约学 | `Ammunition Condensing` |
| drone-servicing | 无人机整备学 | `Drone Servicing` |
| drone-strike | 无人机打击学 | `Drone Strike` |
| drone-durability | 无人机耐久学 | `Drone Durability` |
| drone-reinforce | 无人机强化学 | `Drone Reinforcement` |
| drone-recovery | 无人机回收学 | `Drone Recovery` |
| drone-evasion | 无人机规避学 | `Drone Evasion` |
| shield-operation | 护盾操作学 | `Shield Operation` |
| shield-tuning | 护盾调谐学 | `Shield Tuning` |
| energy-management | 能量管理学 | `Energy Management` |
| hull-upgrades | 船体加固理论 | `Hull Upgrades` |
| armor-tuning | 装甲调谐学 | `Armor Tuning` |
| repair-engineering | 维修工程学 | `Repair Engineering` |
| hull-quick-repair | 舰体快修学 | `Quick Hull Repair` |
| station-protocol | 空间站协议学 | `Station Protocol` |
| ai-expert | AI 核心操作学 | `AI Core Operation` |
| ai-core-dispatch | AI 核心调度学 | `AI Core Dispatch` |
| accelerated-learning | 高效学习法 | `Accelerated Learning` |
| ship-systems-engineering | 舰船系统工程 | `Ship Systems Engineering` |
| accounting | 会计学 | `Accounting` |
| trade-negotiation | 贸易谈判学 | `Trade Negotiation` |
| bounty-hunting | 赏金猎手学 | `Bounty Hunting` |
| marketing | 营销学 | `Marketing` |
| source-sweeping | 现货抢购学 | `Source Sweeping` |
| secondhand-market | 二手市场学 | `Secondhand Market` |
| signal-analysis | 信号分析学 | `Signal Analysis` |
| cartography | 星图测绘学 | `Cartography` |
| signal-filtering | 信号过滤学 | `Signal Filtering` |
| galactic-happenings | 星际奇遇学 | `Galactic Happenings` |
| event-dividend | 事件玄学 | `Event Dividend` |
| chart-archive | 星图记录学 | `Chart Archive` |
| salvage-diving | 漂流物打捞学 | `Salvage Diving` |
| seizure-appraisal | 缴获评估学 | `Seizure Appraisal` |
| lowsec-survival | 低安生存学 | `Low-sec Survival` |
| deep-space-logistics | 深空物流学 | `Deep Space Logistics` |
| hauler-ops | 货舰操作 | `Hauler Operations` |
| compression | 压缩技术 | `Compression` |
| hold-management | 货舱管理学 | `Hold Management` |

## 十、专名表 · 异常点（27）

| id | 中文 | English |
|---|---|---|
| ano-training | 演习场驱逐令 | `Proving Grounds Eviction` |
| ano-pirate-post | 边境海盗前哨 | `Frontier Pirate Outpost` |
| ano-abandoned-platform | 占港武装通缉 | `Occupied Port Warrant` |
| ano-redring-raiders | 赤潮劫掠舰队 | `Red Tide Raider Fleet` |
| ano-gravekeeper | 坟场守墓者 | `Graveyard Gravekeeper` |
| ano-ghost-signal | 幽灵舰信号 | `Ghost Ship Signal` |
| ano-abyss-guard | 深渊之门卫队 | `Abyss Gate Guard` |
| ano-titan-wreck | 泰坦残骸勘探 | `Titan Wreck Survey` |
| ano-auro-raiders | 奥罗武装残骸群 | `Auro Armed Wreck Group` |
| ano-core-section | 巨构核心勘探令 | `Megastructure Core Survey` |
| ano-starcore-boss | 星髓虫群 | `Starcore Swarm` |
| ano-cinder-siege | 烬火围攻战 | `Cinder Siege` |
| ano-echo-haunt | 回音残舰 | `Echo Remnant` |
| ano-nadir-static | 天底静区封锁 | `Nadir Static Blockade` |
| ano-maw-hunt | 噬口猎杀令 | `Maw Hunt Order` |
| ano-vault-sentinel | 穹顶守卫 | `Vault Sentinel` |
| ano-voidedge-warden | 虚海守望者 | `Voidsea Warden` |
| ano-harbor-escort | 新港商路护航令 | `New Harbor Convoy Escort` |
| ano-shard-bandits | 碎晶带劫匪通缉 | `Shardbelt Bandit Warrant` |
| ano-lantern-saboteurs | 信标猎手悬赏 | `Beacon Hunter Bounty` |
| ano-haze-ambush | 灰霾伏击团清剿令 | `Haze Ambush Clearance` |
| ano-mirage-hijackers | 蜃影导航劫持令 | `Mirage Navigation Hijack` |
| ano-chasm-aberrations | 裂谷畸变体猎杀令 | `Chasm Aberration Hunt` |
| enc-pirate-1 | 流窜海盗快艇 | `Roaming Pirate Skiff` |
| enc-pirate-2 | 伏击劫掠队 | `Ambush Raider Squad` |
| enc-pirate-3 | 狂徒巡逻编队 | `Fanatic Patrol Group` |
| enc-pirate-4 | 深空屠夫舰队 | `Deepspace Butcher Fleet` |

## 十一、专名表 · 敌舰（25）与虫洞敌卡（15）

| id | 中文 | English |
|---|---|---|
| foe-pirate-skiff | 海盗快艇 | `Pirate Skiff` |
| foe-pirate-corvette | 劫掠护卫舰 | `Raider Frigate` |
| foe-pirate-sniper | 劫掠狙击舰 | `Raider Sniper` |
| foe-pirate-raider | 劫掠电子舰 | `Raider EW Ship` |
| foe-pirate-warlord | 海盗头目舰 | `Pirate Warlord` |
| foe-scav-skiff | 拾荒武装艇 | `Scavenger Skiff` |
| foe-scav-armed | 拾荒火力舰 | `Scavenger Gunship` |
| foe-alien-rift-larva | 畸变幼虫 | `Aberrant Larva` |
| foe-alien-starcore-larva | 星髓幼虫 | `Starcore Larva` |
| foe-alien-starcore-adult | 星髓成虫 | `Starcore Adult` |
| foe-alien-maw | 噬口巨兽 | `Maw Behemoth` |
| foe-alien-spore-hive | 孢群异虫 | `Spore Hive Aberrant` |
| foe-d-ghost | 幽灵舰 | `Ghost Ship` |
| foe-d-longship | 守墓长舰 | `Gravekeeper Longship` |
| foe-d-stasis | 静滞卫舰 | `Stasis Guard Ship` |
| foe-d-throne | 守墓王座舰 | `Gravekeeper Throne Ship` |
| foe-missile-hulk | 导弹残段 | `Missile Hulk` |
| foe-titan-hulk | 巨构残段 | `Titan Hulk` |
| foe-auro-hulk | 奥罗残骸段 | `Auro Hulk` |
| foe-core-section | 核心舱段 | `Core Section` |
| foe-g-swarm-skiff | 围攻残兵舰 | `Siege Remnant Skiff` |
| foe-g-echo-remnant | 残响残舰 | `Echo Remnant Ship` |
| foe-g-nadir-lock | 天底封锁舰 | `Nadir Blockade Ship` |
| foe-g-exile-battleship | 亡军战列舰 | `Deadarmy Battleship` |
| foe-g-remnant-tender | 残军补给舰 | `Remnant Tender` |
| wh-pirate-scout | 劫掠支队 | `Raider Detachment` |
| wh-pirate-hunt | 劫掠围猎 | `Raider Hunt` |
| wh-pirate-warband | 海盗战团 | `Pirate Warband` |
| wh-alien-swarm | 星髓游猎群 | `Starcore Hunting Swarm` |
| wh-alien-brood | 孢群兵潮 | `Spore Brood Tide` |
| wh-alien-hive | 噬口深巢 | `Maw Deep Hive` |
| wh-grave-watch | 守墓巡哨 | `Gravekeeper Patrol` |
| wh-grave-sentry | 静滞哨链 | `Stasis Sentry Chain` |
| wh-grave-throne | 陵墓王庭 | `Mausoleum Court` |
| wh-titan-echo | 巨构残响 | `Titan Echo` |
| wh-titan-missile | 导弹残响 | `Missile Echo` |
| wh-titan-hulk | 巨构压境 | `Titan Onslaught` |
| wh-exile-blockade | 亡军封锁 | `Deadarmy Blockade` |
| wh-exile-swarm | 残响蜂群 | `Echo Swarm` |
| wh-exile-line | 残军战列线 | `Remnant Battle Line` |

## 十二、P0b 剩余（同规则，下一批出稿）

装备（**142 条**，按「轻型炮台 MK1·动能型 → `Light Turret MK1 · Kinetic`」这类模式批量出稿）· 少量零散表（无人机机型 / 舰体档 / 空间站站点 / 残骸风味 / 旅行事件）。

**舰船蓝图（135 条）不另立表，按派生规则出**（中文侧本来就是派生的）：

| 中文形态 | 英文规则 | 例 |
|---|---|---|
| `<装备名> 蓝图`（`bp-*`） | `<装备英文名> Blueprint` | 强化采集器 MK1 蓝图 → `Reinforced Mining Laser MK1 Blueprint` |
| `<舰名>级舰船蓝图`（`sbp-*`） | 取舰船英文名的**舰级段** + `Blueprint` | 开拓级舰船蓝图 → `Pioneer-class Blueprint` · 皇带鱼级舰船蓝图 → `Oarfish-class Blueprint` |

> 一次性舰船图纸（`sbp-once-*`）与虫洞族图纸（`sbp-wh-*`）同规则；族图纸用 §四 的族舰名
> （如 `Raider Heavy Assault Cruiser Blueprint`）。


