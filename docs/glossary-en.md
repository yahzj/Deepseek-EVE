# 英文术语与专名译名表（English Glossary & Naming Table）

状态：**P0 起草中 · 待船长审后冻结**（2026-09-19 立）
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
| 信用点 | ISK | ⚠ 见待裁决 ① |
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
| ISK 数额 | `476,945,470 ISK` | 千分位用 `,`（`en-US`） |
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
| whale | 鲸吞级采矿艇 | `Whaleswallow-class Mining Corvette` ⚠ 见待裁决 ⑤ |
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
| sh-xuanwu | 玄武级重装旗舰 | `Xuanwu-class Heavy Flagship` ⚠ 见待裁决 ③ |
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
| dept-recall | 检索重启 | `Recall & Restart` | ⚠ 见待裁决 ④ |
| dept-salvage-crew | 老陈一队 | `Chen's Crew No.1` | ⚠ 见待裁决 ④ |

## 七、待你裁决（⓹ 条，冻结前请点名）

① **货币**：英文侧写 `ISK`（代码内部就是 isk，玩家一眼懂）还是 `credit`（更贴「信用点」直译）？中文侧仍写「信用点」不受影响。
② **谜质 / 谜质装置**：`Enigma / Enigma Device` 还是 `Anomalous Matter / Matter Device`？（中文「谜质」是自造词）
③ **玄武级**：`Xuanwu-class`（拼音保留）还是 `Black Tortoise-class`（意译）？
④ **人名 / 特殊部门**：`老陈一队` = `Chen's Crew No.1` OK？`检索重启` 这个部门名我拿不准原意（是"重新检索/重启档案"？）——请给一句解释，我再定英文。
⑤ **鲸吞级**：`Whaleswallow-class`（直译，略长）还是 `Whale-class`（简洁但丢意象）？

## 八、P0b 待补（同规则，下一批出稿）

物品（矿 8 / 材料 14 / 组件 2 / 弹药 6 / 无人机 7 / 货柜 10 / 奢侈品 10 / AI 核心 3 / 谜质装置 20 ≈ **86 条**）·
技能（**79 条**）· 装备（**142 条**，按「轻型炮台 MK1·动能型 → Light Turret MK1 · Kinetic」这类模式批量出）·
舰船蓝图（**135 条**，多数由上面舰船名派生）· 异常点（**27 条**）· 敌舰与敌卡（**40 条**）· 无人机机型 / 舰体档 / 站点（少量）。
