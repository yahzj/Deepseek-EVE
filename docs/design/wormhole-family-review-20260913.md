# 虫洞族专属内容 · **按族总览**（装备 + 舰船）

> **数据来源**：`tools/wh-family-review.ts` 直读代码导出（非手抄）；重跑即更新。
> 状态：**2026-09-13 全部已落码**（施工期：装备/舰船/图纸均标 `unreleased`，对玩家不可见）。

## A 族 · 掠袭（海盗掠夺）（装备 6 件 · 舰船 3 艘）

### 装备

| 装备 | id | 槽/架 | CPU | 效果字段 | 说明 |
|---|---|---|---|---|---|
| **掠袭破片炮** | `mod-wh-a-frag` | turret/high | 48 | damageType=explosive · ammoPerEngagement=20 · maxRangeM=7300 · minRangeM=0 · hitRate=0.8 · falloff=0.5 · reloadMs=5600 · dmgMult=7.04 · cpuUse=48 · secondaryDamagePct=0.5 · secondaryDamageType=kinetic | 会自己炸开的破片弹：**7.3 km 内**撒出一片高爆碎片，单发是攻坚炮台 MK3 的 1.37 倍；碎片不看装甲缝隙——**额外造成 50% 的动能伤害**（与所耗的爆炸弹无关）。代价：命中只有 0.8，装填 5.6 秒。 |
| **掠袭机库** | `mod-wh-a-hangar` | drone-rack/high | 25 | droneBayBonusM3=30 · droneCycleCutPct=0.08 · cpuUse=25 | 把抢来的货舱隔板焊成的机库夹层：无人机舱 **+30 m³**，且**放飞无人机的出击周期 −8%**。装得下又放得快，代价只有 25 点 CPU——是本套最省的一件。 |
| **掠袭加力器** | `mod-wh-a-prop` | propulsion/mid | 18 | speedBonusPct=1.2 · hitPenalty=0.35 · cpuUse=18 | 过载到发红的推进段：战斗机动 **+120%**（矢量推进器 MK3 是 +100%），CPU 只吃 18。代价是开火失稳到极点——**命中 ×0.65**。抢完就跑才是它的正经用法。 |
| **掠袭折射涂层** | `mod-wh-a-coat` | armor/low | 34 | evasionGapPct=0.28 · allResistPenaltyPct=0.15 · cpuUse=34 | 一层会骗测距的涂层：被命中缺口再削 **28%**（姿态陀螺 MK3 是 20%），代价是**全抗性 −15**——盾、甲、结构三层一起变脆。保命也保货，但别指望它扛。 |
| **赃物扫描阵** | `mod-wh-a-scan` | support/mid | 36 | hitBonusPct=0.24 · rangeCutPct=0.15 · cpuUse=36 | 拼装起来的火控阵列：炮台命中整体 **×1.24**（索敌阵列 MK3 是 ×1.16），代价是**武器射程 −15%**——看得更准，但得让对方更靠近。 |
| **掠袭者护盾笼** | `mod-wh-a-shield` | shield/mid | 46 | shieldHpBonus=0.8 · rangeCutPct=0.25 · cpuUse=46 | 把三块抢来的护盾发生器串成一个笼：护盾容量 **+80%**（护盾扩展器 MK3 是 +60%）。代价是**武器射程 −25%**：护盾笼挤占了炮座的位置。 |

### 舰船

| 舰船 | id | 子分类 | 档/角色 | 槽 高/中/低 | CPU | 盾/甲/壳 | 机巢 | 特色与加成 | 机动侧 |
|---|---|---|---|---|---|---|---|---|---|
| **掠袭电子舰** | `sh-wh-a-frigate` | 电子舰 | T1/armed | 3/3/1 | 165 | 130/60/55 | 10 | **虫洞扫码 +1 圈（编队即生效、可叠加）** · 命中 +0.25 · 电力 +0.3 · 抗性：shield {"kinetic":0.5} | 回避 0.216 · 速 350 · 机动 0.675 · 货舱 1260 · 机巢 10m³ |
| **掠袭炮艇** | `sh-wh-a-destroyer` | 炮艇 | T2/armed | 5/3/2 | 250 | 175/130/130 | 30 | 族武 {"kinetic":0.15} · 武器射程 {"kinetic":0.3} · 命中 +0.2 · 电力 +0.45 · 抗性：shield {"kinetic":0.5} | 回避 0.12 · 速 300 · 机动 0.62 · 货舱 3080 · 机巢 30m³ |
| **掠袭重型突击巡洋舰** | `sh-wh-a-cruiser` | 重型突击巡洋舰 | T3/armed | 6/3/3 | 390 | 375/225/255 | 50 | 命中 +0.17 · 电力 +0.65 · 抗性：shield {"kinetic":0.5,"explosive":0.25,"plasma":0.25} / armor {"kinetic":0.25,"explosive":0.25,"plasma":0.25} / hull {"kinetic":0.25,"explosive":0.25,"plasma":0.25} | 回避 0.12 · 速 225 · 机动 0.385 · 货舱 3640 · 机巢 50m³ |

## C 族 · 巢群（生体甲壳）（装备 5 件 · 舰船 3 艘）

### 装备

| 装备 | id | 槽/架 | CPU | 效果字段 | 说明 |
|---|---|---|---|---|---|
| **生体棱镜束** | `mod-wh-c-laser` | laser/high | 60 | damageType=plasma · ammoPerEngagement=22 · maxRangeM=8600 · minRangeM=0 · hitRate=1 · falloff=0.1 · reloadMs=5600 · dmgMult=7.6 · cpuUse=60 | 生体棱镜阵列射出的酸蚀光束：**8.6 km 必中**、单发是激光炮 MK3 的 1.8 倍。比同族的酸液喷吐器远出三倍——贴脸有喷吐器，这件管的是"它想拉开距离"的时候。代价是装填 5.6 秒。 |
| **甲壳棱镜层** | `mod-wh-c-prism` | armor/low | 46 | armorResistAdd={"kinetic":0.3,"explosive":0.3,"plasma":0.3} · cpuUse=46 | 甲壳里析出的棱晶结构：**三系装甲抗性各削三成缺口**（动能 / 爆破 / 等离子一视同仁）。护盾薄的族，只能把甲做成棱镜。 |
| **生体脉搏加速器** | `mod-wh-c-pulse` | support/low | 42 | reloadCutPct=0.06 · speedBonusPct=0.1 · cpuUse=42 | 以生体脉搏驱动装填链：炮台装填间隔 **÷1.06**（射速计算机 MK3 是 ÷1.12），并让**舰船速度 +10%**。占用 42 点 CPU——打得快，也跑得快。 |
| **孢子导弹巢** | `mod-wh-c-missile` | missile/high | 58 | damageType=explosive · ammoPerEngagement=30 · maxRangeM=13500 · minRangeM=400 · hitRate=0.5 · falloff=1 · reloadMs=7600 · dmgMult=9.68 · cpuUse=58 | 会自己散开的孢子囊：13.5 km 爆破覆盖、单发是导弹架 MK3 的 1.6 倍，**一次罩住全部敌舰**（机制待落，见设计稿 §3.8）。散布极大（命中 0.5）、装填 7.6 秒——它负责把整片战场铺满。 |
| **几丁质骨架层** | `mod-wh-c-frame` | armor/low | 46 | hullHpBonus=0.75 · speedBonusPct=0.05 · cpuUse=46 | 把整副骨架换成几丁质复合层：结构层容量 **+75%**（巨构骨架是 +60%），并让**舰船速度 +5%**——壳更厚，却更轻。护盾与装甲被打穿之后，最后那段血就靠它。 |

### 舰船

| 舰船 | id | 子分类 | 档/角色 | 槽 高/中/低 | CPU | 盾/甲/壳 | 机巢 | 特色与加成 | 机动侧 |
|---|---|---|---|---|---|---|---|---|---|
| **幼虫截击舰** | `sh-wh-c-frigate` | 截击舰 | T1/armored | 2/3/3 | 170 | 35/90/130 | 10 | 命中 +0.1 · 抗性：armor {"explosive":0.5} / hull {"kinetic":0.25} | 回避 0.1 · 速 432 · 机动 0.837 · 货舱 630 · 机巢 10m³ |
| **甲壳截击舰** | `sh-wh-c-destroyer` | 截击舰 | T2/armored | 2/4/4 | 215 | 30/150/220 | 30 | 命中 +0.09 · 抗性：armor {"explosive":0.5} / hull {"kinetic":0.25} | 回避 0.06 · 速 331 · 机动 0.675 · 货舱 1330 · 机巢 30m³ |
| **巢群重型突击巡洋舰** | `sh-wh-c-cruiser` | 重型突击巡洋舰 | T3/armored | 3/4/5 | 280 | 85/455/515 | 50 | 命中 +0.05 · 抗性：shield {"kinetic":0.25,"explosive":0.25,"plasma":0.25} / armor {"explosive":0.5,"kinetic":0.25,"plasma":0.25} / hull {"kinetic":0.25,"explosive":0.25,"plasma":0.25} | 回避 0.04 · 速 166 · 机动 0.294 · 货舱 2940 · 机巢 50m³ |

## D 族 · 陵墓（护盾堡垒）（装备 6 件 · 舰船 3 艘）

### 装备

| 装备 | id | 槽/架 | CPU | 效果字段 | 说明 |
|---|---|---|---|---|---|
| **陵卫连装炮** | `mod-wh-d-turret` | turret/high | 46 | damageType=kinetic · ammoPerEngagement=40 · maxRangeM=5400 · minRangeM=300 · hitRate=0.86 · falloff=0.4 · reloadMs=2800 · dmgMult=9.2 · ammoPerShot=2 · cpuUse=46 | 陵卫的连装炮：5.4 km 内 2.8 秒一轮，单发是攻坚炮台 MK3 的 1.79 倍——**一轮打出两发弹药**。长炮点名硬目标，它负责把贴上来的一群清掉。 |
| **陵墓护盾芯** | `mod-wh-d-shield` | shield/mid | 52 | shieldHpBonus=0.9 · cpuUse=52 | 从陵墓阵列里取出的核心：护盾容量 **+90%**（护盾扩展器 MK3 是 +60%）。与本族那套"三系抗性的盾"互补——一个管厚度，一个管硬度。 |
| **守墓者丧钟** | `mod-wh-d-lock` | target-lock/high | 40 | lockDmgBonus=0.3 · cpuUse=40 | 锁定即宣判：被本舰锁定的目标**受击加深 30%**（目标锁定阵列 MK3 是 20%），且全舰武器转为集火同一目标——先敲最硬的那一个。 |
| **陵寝棱镜炮** | `mod-wh-d-laser` | laser/high | 68 | damageType=plasma · ammoPerEngagement=18 · maxRangeM=12500 · minRangeM=0 · hitRate=1 · falloff=0.1 · reloadMs=6800 · dmgMult=9.4 · cpuUse=68 | 把陵墓顶端的棱镜拆下来当炮管：**12.5 km 必中光束**、单发是激光炮 MK3 的两倍多。装填 6.8 秒是本套最慢——瞄准的时间，就是它全部的代价。 |
| **守墓者速装填机** | `mod-wh-d-loader` | support/low | 54 | reloadCutPct=0.18 · cpuUse=54 | 一套不知疲倦的机械装填臂：炮台装填间隔 **÷1.18**（射速计算机 MK3 是 ÷1.12）。必中长炮唯一的短板就是慢，它专补这一处。 |
| **陵墓弹道铭文** | `mod-wh-d-steady` | support/low | 30 | damageTypeBonusPct={"kinetic":0.18,"plasma":0.18} · cpuUse=30 | 刻在炮闩上的铭文：**动能与能量武器单发各 +18%**。守墓者的炮不是动能就是能量，它两系都认。 |

### 舰船

| 舰船 | id | 子分类 | 档/角色 | 槽 高/中/低 | CPU | 盾/甲/壳 | 机巢 | 特色与加成 | 机动侧 |
|---|---|---|---|---|---|---|---|---|---|
| **哨戒电子舰** | `sh-wh-d-frigate` | 电子舰 | T1/armored | 2/3/3 | 165 | 170/35/55 | 10 | **虫洞扫码 +1 圈（编队即生效、可叠加）** · 命中 +0.22 · 抗性：shield {"kinetic":0.25,"explosive":0.25,"plasma":0.25} / armor {"explosive":0.5} / hull {"kinetic":0.25,"explosive":0.25,"plasma":0.25} | 回避 0.109 · 速 300 · 机动 0.495 · 货舱 770 · 机巢 10m³ |
| **陵卫指挥舰** | `sh-wh-d-destroyer` | 指挥舰 | T2/armored | 2/4/4 | 220 | 230/75/80 | 45 | 无人机伤害 +0.08 · **全舰单发 +0.15（编队光环，取最高）** · 命中 +0.11 · 抗性：shield {"kinetic":0.25,"explosive":0.25,"plasma":0.25} / armor {"explosive":0.5} / hull {"kinetic":0.25,"explosive":0.25,"plasma":0.25} | 回避 0.045 · 速 220 · 机动 0.45 · 货舱 2700 · 机巢 45m³ |
| **陵寝巡洋舰** | `sh-wh-d-cruiser` | （无） | T3/armored | 2/5/5 | 300 | 510/155/255 | 50 | 命中 +0.05 · 抗性：shield {"kinetic":0.25,"explosive":0.25,"plasma":0.25} / armor {"explosive":0.5} / hull {"kinetic":0.25,"explosive":0.25,"plasma":0.25} | 回避 0.04 · 速 175 · 机动 0.4 · 货舱 9000 · 机巢 50m³ |

## E 族 · 巨构（自建支援）（装备 5 件 · 舰船 3 艘）

### 装备

| 装备 | id | 槽/架 | CPU | 效果字段 | 说明 |
|---|---|---|---|---|---|
| **巨构损管阵列** | `mod-wh-e-dc` | armor/low | 38 | hullResistAdd={"kinetic":0.3,"explosive":0.3} · hullHpBonus=0.35 · cpuUse=38 | 巨构造物的自带损管网：**结构对动能与爆炸的抗性各 +30%**、**结构值 +35%**，占用只有 38 点 CPU。巨构本来是挨打不还手的料，这一层让它挨得住第二轮。 |
| **巨构导控塔** | `mod-wh-e-tac` | drone-tac/high | 44 | droneDmgBonus=0.5 · cpuUse=44 | 塔状的机群指挥中枢：放飞无人机单发 **+50%**（鱿蜂群导控是 +45%）。机库族缺的从来不是数量，是让它们打得疼。 |
| **巨构协处理器** | `mod-wh-e-cpu` | cpu/low | 0 | cpuBonus=90 · reloadPenaltyPct=0.12 · cpuUse=0 | 巨构造物的并行计算核心：装配 CPU 上限 **+90**，自身不占 CPU，代价是**全舰装填 +12%**——算力是借来的，得用射速还。 |
| **巨构近防阵列** | `mod-wh-e-pd` | turret/high | 56 | damageType=kinetic · ammoPerEngagement=64 · maxRangeM=2500 · minRangeM=1 · hitRate=0.92 · falloff=0.5 · reloadMs=1200 · dmgMult=3.7 · antiDrone=2 · cpuUse=56 | 一整套阵列化点防：射程 2.5 km（防空武器统一射程），单发是近防炮 MK3 的 1.3 倍、射速也更快——贴在脸上，它是本套最快的一门。防空属性与制式近防炮同为 ×2，赢在单发与节奏。 |
| **巨构护盾矩阵** | `mod-wh-e-shield` | shield/mid | 70 | shieldResistAdd={"kinetic":0.32,"plasma":0.32} · shieldHpBonus=0.42 · cpuUse=70 | 矩阵式护盾发生层：**动能与能量护盾抗性各 +32%**，同时把**护盾上限抬高 42%**（陵墓护盾阵列只给抗性）。占用 70 点 CPU——巨构族的第一块盾，也是本套最贵的一件。 |

### 舰船

| 舰船 | id | 子分类 | 档/角色 | 槽 高/中/低 | CPU | 盾/甲/壳 | 机巢 | 特色与加成 | 机动侧 |
|---|---|---|---|---|---|---|---|---|---|
| **构件鱼雷舰** | `sh-wh-e-frigate` | 鱼雷舰 | T1/armed | 4/2/2 | 200 | 115/60/80 | 30 | 族武 {"explosive":0.15} · 命中 +0.17 · 电力 +0.25 · 抗性：shield {"kinetic":0.5} / hull {"plasma":0.25} | 回避 0.105 · 速 315 · 机动 0.7 · 货舱 1000 · 机巢 30m³ |
| **机库无人机作战舰** | `sh-wh-e-destroyer` | 无人机作战舰 | T2/armed | 4/4/3 | 290 | 230/90/115 | 105 | 无人机伤害 +0.1 · 命中 +0.14 · 电力 +0.4 · 抗性：shield {"kinetic":0.5} / hull {"plasma":0.25} | 回避 0.1 · 速 275 · 机动 0.6 · 货舱 1960 · 机巢 105m³ |
| **巨构无人机作战舰** | `sh-wh-e-carrier` | 无人机作战舰 | T3/armed | 5/5/3 | 440 | 410/160/200 | 145 | 无人机伤害 +0.14 · 命中 +0.14 · 电力 +0.6 · 抗性：shield {"kinetic":0.5} / hull {"plasma":0.25} | 回避 0.1 · 速 250 · 机动 0.5 · 货舱 2660 · 机巢 145m³ |

## G 族 · 亡军（隐身机群）（装备 6 件 · 舰船 3 艘）

### 装备

| 装备 | id | 槽/架 | CPU | 效果字段 | 说明 |
|---|---|---|---|---|---|
| **亡军蜂巢坞** | `mod-wh-g-hangar` | drone-rack/high | 54 | droneBayBonusM3=110 · cpuUse=54 | 由废弃蜂巢改成的机坞：无人机舱 **+110 m³**（深层机库是 +95）。亡军给了无人机伤害与射程，唯独没给"装得下"——这就是那一块。 |
| **亡军火控** | `mod-wh-g-fcs` | support/mid | 36 | hitBonusPct=0.12 · damageBonusPct=0.06 · cpuUse=36 | 从沉船里捡回的火控残骸，还在按老参数工作：炮台命中整体 **×1.12**，并让**全部武器单发 +6%**。它记得上一任主人的射击习惯。 |
| **幽灵弹道校正器** | `mod-wh-g-ballistic` | support/low | 60 | damageTypeBonusPct={"kinetic":0.22} · rangeTypeBonusPct={"kinetic":0.22} · cpuUse=60 | 一把没有主人的弹道仪：**动能武器单发 +22%**，并把**动能武器的射程拉长 22%**。占用 60 点 CPU——亡军的炮都是捡来的动能炮，校正器也只好认这一系。 |
| **残兵结构层** | `mod-wh-g-hull` | armor/low | 44 | armorHpBonus=0.18 · hullResistAdd={"kinetic":0.28,"explosive":0.28,"plasma":0.28} · cpuUse=44 | 一层用同族残骸回炉重铸的结构层：**三系结构抗性各削二成八缺口**，另带装甲容量 **+18%**。亡军没有完整的船，只有拆下来的骨。 |
| **亡军残炮** | `mod-wh-g-turret` | turret/high | 54 | damageType=explosive · ammoPerEngagement=36 · maxRangeM=8600 · minRangeM=700 · hitRate=0.75 · falloff=0.4 · reloadMs=4600 · dmgMult=11.5 · cpuUse=54 | 把三门废炮的部件拼成一门：单发是攻坚炮台 MK3 的两倍多，命中只有 0.75——它经手过太多任主人，膛线早就花了。 |
| **幽灵推进器** | `mod-wh-g-prop` | propulsion/mid | 36 | speedBonusPct=0.85 · cpuUse=36 | 没有排气痕迹的推进段：战斗机动 **+85%**，而且不像掠袭加力器那样拖累命中。幽灵的走法是悄无声息地靠近。 |

### 舰船

| 舰船 | id | 子分类 | 档/角色 | 槽 高/中/低 | CPU | 盾/甲/壳 | 机巢 | 特色与加成 | 机动侧 |
|---|---|---|---|---|---|---|---|---|---|
| **幽影侦察舰** | `sh-wh-g-frigate` | 侦察舰 | T1/armed | 3/4/1 | 175 | 140/45/65 | 10 | 无人机伤害 +0.06 · **虫洞扫码 +1 圈（编队即生效、可叠加）** · 命中 +0.2 · 电力 +0.28 · 抗性：shield {"kinetic":0.5} | 回避 0.27 · 速 383 · 机动 0.82 · 货舱 490 · 机巢 10m³ |
| **亡军后勤舰** | `sh-wh-g-destroyer` | 后勤舰 | T2/armed | 4/4/3 | 260 | 230/75/115 | 45 | 无人机伤害 +0.1 · 命中 +0.15 · 电力 +0.45 · 抗性：shield {"kinetic":0.5} | 回避 0.147 · 速 310 · 机动 0.68 · 货舱 3480 · 机巢 45m³ |
| **亡军鱼雷舰** | `sh-wh-g-cruiser` | 鱼雷舰 | T3/armed | 5/5/3 | 410 | 345/185/225 | 60 | 族武 {"explosive":0.15} · 无人机伤害 +0.14 · 命中 +0.21 · 电力 +0.62 · 抗性：shield {"kinetic":0.5} | 回避 0.105 · 速 285 · 机动 0.493 · 货舱 3200 · 机巢 60m³ |

