/**
 * 异常空间/悬赏目标表（M3）：远征目的地。
 *
 * 设计（中文说明）：按声望阶梯排布——新手先清剿母港演习场攒声望，
 * 逐步解锁更远更危险的悬赏；火力 = 10 + 炮术学×2/级，
 * 胜率 = 火力/(火力+威胁)，威胁 35+ 的目标建议练满炮术学再碰。
 *
 * **2026-09-10 船长：「将所有常驻悬赏附赠的矿石移除了」**——本表全部悬赏卡的 `loot` 附赠
 * 一律清空（26 张里原有 20 张带附赠：19 张是矿物、1 张是原矿富凡晶石×150，合计 ≈19.3 万 ISK
 * 的一次性附赠全部退场），卡面只剩「奖金 + 声望」；两处提到"顺手回收矿石/矿物归你"的卡面文案
 * 同步改写。`loot` 字段与结算链路（远征/AI 副船发放、卡面「+ 附赠」、重复清剿的货仓判定）
 * **保留不动**，方便日后给新卡挂附赠；现值一律为空数组。
 */

import type { AnomalyDef } from '@whale/core'
import { foeLayerSplit } from '@whale/core'
import { withRecycleFlavor } from './salvageFlavors'
import {
  FOE_SCAV_ARMED,
  FOE_SCAV_SKIFF,
  FOE_SHIP_PIRATE_CORVETTE,
  FOE_SHIP_PIRATE_SKIFF,
  FOE_SHIP_PIRATE_SNIPER,
  FOE_SHIP_PIRATE_WARLORD,
} from './foe-ships'

/**
 * **赤潮 / 蜃影 的「狙击舰变体」射程倍率**（试点期就有的逐卡变体倍率）。
 * 2026-09-11 起**两处共用**：杂鱼条目的 `rangeMul` + **头目条目的「同卡同带」绝对射程覆写**
 * （船长裁决③：头目可配多战术 ⇒ 射程多重方案；用同一常量推导线，避免两处手抄数字漂移）。
 */
const REDRING_RANGE_MUL = 12021 / 11316
const MIRAGE_RANGE_MUL = 13667 / 11316

/**
 * **A 族数值落地批的共用口径（2026-09-11 船长确认「先按照你的提议实现」）**
 *
 * 六张 A 族卡统一编成 = **头目舰 ×1 + 本卡原有舰级 ×3**（N = 4 个单位），于是：
 * - **血**：总血守恒（卡的原值）——头目 **60%**、每杂鱼 **40% ÷ 3**；卡上写 `hpMul`（舰级绝对值 × 倍率）。
 * - **火力**：名义总 DPS 守恒 = `威胁 × foeDpsPerThreat(0.8) × 多舰补偿 1.6`，头目 60% / 每杂鱼 40%÷3；
 *   单发按既有推导（固定系 `× 装填4s × 命中补偿0.62 ÷ 有效命中`；光束不消费命中补偿）。
 *   ⚠ **例外两张**（2026-09-11 船长裁决 = 方案 B）：**赤潮 / 蜃影** 旧带逐卡伤害压制倍率
 *   （旧 `foeDmgMul` 0.27 / 0.30，已退休），按威胁曲线重锚会**无声取消压制** ⇒ 实际火力 ×5.3~6.0；
 *   故这两张按 **「改造前的实际火力 × 1.6」重锚**（卡上 `dmgMul`，**不恢复 `foeDmgMul`**）——见各卡注释。
 * - **血型**（2026-09-11 船长裁决①「**头目血型随卡片走**」）：条目可写 `split` 覆写，
 *   **有效 split = 覆写 ?? 舰级**；头目舰是装甲型，故**卡面非装甲的四张**（信标 均衡 / 灰霾·赤潮·蜃影 护盾）
 *   在其头目条目上用 `foeLayerSplit(卡面 defProfile)` 覆写（**不手抄数字**）。
 *   A 族**无族级血型约束**（船长：鱼龙混杂 ⇒ 什么血型都有），逐卡自定。
 * - **射程**（同日裁决③「头目可以多种战术选择，因此**射程方案也是多重**」）：头目可配多战术，
 *   射程随之**按卡**给——**近战卡（边境/碎晶）不写覆写**；**头目打不到的卡**在其头目条目写
 *   `rangeMinM`/`rangeMaxM` = **本卡杂鱼（主体）的射程带**（同卡同带，让 60% 火力真正落地）。
 * - `A_MULTI_SHIP_COMP` 只在**本条算式**里用（把补偿从设计单发里除掉），**引擎会自己按 N 施加它**
 *   （`core/createFoeSpecsFromShips`）——所以卡上写的是"设计单发 ÷ 舰级单发 ÷ 补偿"。
 * - ⚠ 逐卡推算与实测对照见 `docs/design/foe-faction-a-numbers-20260911.md`。
 */
const A_MULTI_SHIP_COMP = 1.6 // = 2N/(N+1)，N = 4

export const ANOMALIES: readonly AnomalyDef[] = [
  {
    id: 'ano-training',
    // 2026-09-11 族系单一真相源（船长定案）：本卡原先**美术侧登记为 B、数据侧 `foeFamily` 为空**
    // （`shipArt.tsx` 的硬编码 `FOE_FAMILY` 与数据字段各写各的）——现按数据侧补齐为 B，
    // 并删掉美术侧那张硬编码表，敌族一律由 `AnomalyDef.foeFamily` 推导（口径统一）。
    foeFamily: 'B',
    name: '演习场驱逐令',
    // B 族落码批（2026-09-11 船长七裁决）：迁入**舰级路径**（拾荒武装艇 ×1）。
    // 原 `foeHpOverride 22` / `foeSpeedMps 322` 退场——数值由舰级（`foe-scav-skiff`，基准即本卡现状值）供给，
    // **除速度外逐字不变**：血 22 / 单发 14（纯动能）/ 命中 0.85 / 射程 1~2200 / 衰减 0.3 / 近盲 0.3。
    // 速度：旧绝对 322 → **306**（舰级 `speedRatio 0.90`，船长「速度偏慢」——**有意改慢**）。
    ships: [{ ship: FOE_SCAV_SKIFF }],
    galaxyId: 'galaxy-hub',
    threat: 6,
    tactic: 'orbit', // 船长：B 族战术统一 orbit（原 brawl）
    defProfile: 'balanced',
    standingReq: 0,
    standingGain: 1,
    rewardIsk: 3_600, // 本地悬赏（2026-09-08 船长定）：胜利返港固定 2 分钟（120s）后，奖励按新港每分钟费率对齐：3,600÷(交火2min+返港2min)=900 ISK/min ≈ 新港 6,400÷7min≈914（取整百略留教学利差）；防零航程白刷（旧 1,000@0返航=30k/h 压到教学水平的口径随返航段同步退出）
    loot: [],
    combatSeconds: 20,
    description: '深空工业协会的例行清场令：拾荒船常年在演习场边缘翻捡演习残骸，协会按次悬赏驱逐。悬赏常设、可反复接取——新手的第一张长期单。',
  },
  {
    id: 'ano-pirate-post',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '边境海盗', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 1, // 窝点地图级别（1 = 只出外围档）：族内最弱的近处图，柯尔边境是高安、日板不派发（档位上限仅作档案）
    name: '边境海盗前哨',
    // A 族数值落地批（2026-09-11 船长确认）：编成 = **头目舰 ×1 + 海盗快艇 ×3**（共 4 单位）。
    // 血：总额 150 → 头目 150×60% = 90（hpMul = 150×3/5 ÷ 360 = 0.25）、每杂鱼 150×40%÷3 = 20（20 ÷ 150）。
    // 火力：名义总 DPS = 12 × 0.8 × 1.6 = **15.36** → 头目 9.216 / 每杂鱼 2.048；
    //   单发 = 名义DPS × 4s × 0.62 ÷ 有效命中 → 头目 9.216×4×0.62/0.9 = 25.3952 → **25**，
    //   杂鱼 2.048×4×0.62/0.85 = 5.9753 → **6**；Σ = 43，名义 Σ = 43.3212 → **取整偏差 0**。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (150 * 3) / 5 / FOE_SHIP_PIRATE_WARLORD.hp, // = 90/360
        dmgMul: 25 / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // = 25/(56×1.6)
        // 头目按**卡面构成**打（头目舰缺省是动能主系；本卡是爆炸主系）——玩家看到的就是实际吃的
        dmgMix: { explosive: 8, kinetic: 2 },
      },
      {
        ship: FOE_SHIP_PIRATE_SKIFF,
        count: 3,
        hpMul: (150 * 2) / 15 / FOE_SHIP_PIRATE_SKIFF.hp, // = 20/150
        dmgMul: 6 / (FOE_SHIP_PIRATE_SKIFF.shotDmg * A_MULTI_SHIP_COMP), // = 6/(28×1.6)
      },
    ],
    galaxyId: 'galaxy-kor',
    threat: 12,
    tactic: 'brawl',
    defProfile: 'armor',
    dmgMix: { explosive: 8, kinetic: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 1,
    standingGain: 1,
    rewardIsk: 12_000,
    loot: [],
    combatSeconds: 20,
    description: '通缉册上的老面孔：柯尔边境的前哨海盗团长期袭扰新手商路。悬赏常设，击溃即结算，可反复接取。',
  },
  {
    id: 'ano-abandoned-platform',
    foeFamily: 'B', // 敌族（与美术层 FOE_ART 族字母同源）
    // ⚠ **`lairCore` 已退役（2026-09-11 船长裁决「B 族没有窝点、排除出赏金范围」）**：
    // 本卡曾带 `lairCore: '占港拾荒团'`，按"方案 2"删除字段（数据层干净）——
    // **旧档兼容去向 = `RETIRED_LAIR_CARD_IDS` 白名单**（`docs/design/foe-faction-b-scavenger-20260911.md` §六；
    // 让旧档里已获得的 `wreck-rare-ano-abandoned-platform` 仍能被识别与开箱）。**不是漏标，勿加回来**（契约会拦）。
    name: '占港武装通缉',
    // B 族落码批（2026-09-11 船长七裁决）：迁入**舰级路径**（拾荒火力舰 ×1）——舰级基准即本卡现状值，
    // 故血 292 / 单发 58 / 射程 366~4815 / 构成 8:2 / 血型均衡**逐字不变**，无需任何倍率。
    // 速度：旧绝对 286 → **271**（舰级 `speedRatio 0.92`，船长「速度偏慢」——**有意改慢**）。
    // ⚠ **乱射（命中 0.55）不动**，但它是**单卡特征**（不是族级签名），故写在**本卡条目**上、不写进舰级。
    ships: [{ ship: FOE_SCAV_ARMED, hitRate: 0.55 }],
    galaxyId: 'galaxy-dust',
    threat: 16,
    tactic: 'orbit', // 船长：B 族战术统一 orbit（本卡原即 orbit）
    defProfile: 'balanced',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 2,
    standingGain: 1,
    rewardIsk: 20_000,
    loot: [],
    combatSeconds: 20,
    description: '长期通缉：武装拾荒者盘踞废弃采掘平台多年，协会悬赏清除其火力点。',
  },
  {
    id: 'ano-redring-raiders',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '赤潮劫掠团', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：A 族次强（红环航道）
    name: '赤潮劫掠舰队',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠狙击舰 ×3**。
    // 头目舰缺省 brawl、本卡 kite → `tactic: 'kite'` 覆写；主系覆写为**能量**（缴获改装的能量炮）⇒
    //   头目与杂鱼都走**光束必中**（不消费命中补偿），故单发 = 火力 × 装填 4s。
    // 血：340 → 头目 204（204÷360）、每杂鱼 340×40%÷3 = 45.3333（45.3333÷268.75，Σ 精确 = 340）。
    // ⚠ **火力重锚（2026-09-11 船长裁决 = 方案 B + 纸面锚 ×1.2）**：本卡**不走威胁曲线**——原口径按
    //   `威胁 × 0.8 × 1.6 = 43.52` 重锚单发时，把本卡旧有的**逐卡伤害压制倍率（旧 `foeDmgMul` 0.27）**
    //   无声取消了，实际火力 7.25 → 43.25（×5.97），实测难度失控。
    //   **船长裁决：锚回"改造前的实际火力"**（**不恢复已退休的 `foeDmgMul`**，改用卡上 `dmgMul` 重锚）；
    //   纸面锚点由 ×1.6 下调为 **×1.2**（理由：难度守恒按「**实收**」判定——4 单位逐个被击毁 ⇒
    //   实收积分 ≈ 纸面 ×`(N+1)/(2N)` = ×0.625，而本卡改动前只有 2 单位（衰减 ×0.75），
    //   纸面 ×1.6 会实收成改动前的 ×1.33；要"实收 ≈ 改动前"须用纸面 ×`0.75/0.625` = **×1.2**）。
    //   → 目标实际火力 = 7.25 × 1.2 = **8.70**；重锚单发（光束，÷装填 4s、按 60%/40%÷3 分配后取整）：
    //   头目 0.6×8.70×4 = 20.88 → **21**、每杂鱼 (0.4/3)×8.70×4 = 4.64 → **5**；
    //   Σ = 36 → **纸面 9.00**（目标 8.70，取整 +3.4%）；实收 = 9.00 × 0.625 = **5.63** ≈ 改动前 7.25 的 ×0.78。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (340 * 3) / 5 / FOE_SHIP_PIRATE_WARLORD.hp, // = 204/360
        dmgMul: 21 / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 21/(56×1.6)
        split: foeLayerSplit('shield'), // 血型随卡走（船长裁决①）：卡面护盾 → 头目也护盾
        // 射程多重方案（船长裁决③）：头目原 1~2210m 在本卡 3312m 交战距离下 0 次开火（探针实测）
        // ⇒ 同卡同带（与杂鱼同式的变体倍率推导，**不手抄数字**）
        rangeMinM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMinM * REDRING_RANGE_MUL),
        rangeMaxM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMaxM * REDRING_RANGE_MUL),
        tactic: 'kite',
        dmgMix: { plasma: 8, kinetic: 2 },
      },
      {
        ship: FOE_SHIP_PIRATE_SNIPER,
        count: 3,
        hpMul: (340 * 2) / 15 / FOE_SHIP_PIRATE_SNIPER.hp, // = 45.3333/268.75
        dmgMul: 5 / (FOE_SHIP_PIRATE_SNIPER.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 5/(41×1.6)
        speedMul: 204 / 201,
        rangeMul: REDRING_RANGE_MUL,
        dmgMix: { plasma: 8, kinetic: 2 },
      },
    ],
    galaxyId: 'galaxy-redring',
    threat: 34,
    tactic: 'kite',
    defProfile: 'shield',
    dmgMix: { plasma: 8, kinetic: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 3,
    standingGain: 1,
    rewardIsk: 75000,
    loot: [],
    combatSeconds: 70,
    description: '红环航道的老牌劫掠舰队，通缉令在协会悬赏板上挂了五年——击退其主力即可结算，可反复接取。',
  },
  {
    id: 'ano-gravekeeper',
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '坟场守墓者', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 2, // 窝点地图级别（2 = 到核心档）：暗星坟场（威胁 88、奖金 110 万）
    name: '坟场守墓人',
    foeHpOverride: 3600, // 巡洋时代复调轮 r4（2026-09-09）：E 段——锤头鲨中位 53s✅；无技能参考 60%→≥70% 宽容线（原 r1 3900）
    // 2026-09-10 船长（族系改判）：**brawl → orbit**（D 族＝残破古典长舰 + 12 km 必中点名炮，不该在 2.8 km 贴脸）。
    // 血量未动：实测曲线（中位参考行）血 ≤120 → 80%/20s/残血 54%、血 310 → 100%/30s/残血 23%、血 ≥1200 → 0%——
    // 要它"可打"得砍到 ~310（−91%）；保持 3600 则与虚海 88 / 穹顶 96 并列成为 D 族第三张 E 段墙。**船长待裁**。
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 345, // 敌速重标（2026-09-10 船长）：改判 orbit 后按 orbit 口径 **1.18×** 基准船（长尾鲨级 272 → 战斗机动 165）；改判前 433（brawl 1.48×）
    waves: [
      { units: 2, hpShare: 0.55 },
      { units: 1, hpShare: 0.45 },
    ], // 多波次（2026-09-09 船长拍板首批：低安顶段 90~150s 无喘息；docs/design/wave-battles-20260909.md）
    galaxyId: 'galaxy-grave',
    threat: 88,
    tactic: 'orbit', // 2026-09-10 船长（族系改判）：**brawl → orbit**（D 族＝残破古典长舰 + 12 km 必中点名炮）
    defProfile: 'armor',
    dmgMix: { kinetic: 8, plasma: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 12,
    standingGain: 4,
    rewardIsk: 1100000,
    loot: [],
    combatSeconds: 60,
    description: '暗星坟场的守墓舰队从不轮换，协会对它的通缉令也从未撤销：击退一次，结算一次。',
  },
  {
    id: 'ano-ghost-signal',
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '幽灵舰', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 1, // 窝点地图级别（1 = 只出外围档）：D 族最弱（红环航道，奖金 16.5 万）
    // 注：同星系的 A 族「赤潮劫掠舰队」为 3 级，日板按"同星系取级别最高"进池（本卡会被顶掉）
    name: '幽灵舰信号',
    foeHpOverride: 555, // P1 微调轮（2026-09-06）：C 段灰鲭鲨4MK2 中位 ~50s
    foeSpeedMps: 234, // 敌速上调（2026-09-09 船长：推进器翻倍后按战术分工锚定中高段）kite ×1.35（旧 173）
    galaxyId: 'galaxy-redring',
    threat: 46,
    tactic: 'kite',
    defProfile: 'shield',
    escorts: 1,
    dmgMix: { explosive: 8, plasma: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 5,
    standingGain: 2,
    rewardIsk: 165000,
    loot: [],
    combatSeconds: 90,
    description: '一桩悬了许久的疑案：幽灵舰定期在红环深处现身又消失。协会对每一次成功接触都发放调查赏金——它到底是什么，至今没人说清。',
  },
  {
    id: 'ano-abyss-guard',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '深渊潜伏群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 1, // 窝点地图级别（1 = 只出外围档）：C 族最弱（深渊之门，奖金 16 万）
    // 注：同星系的 E 族「泰坦残骸勘探」为 3 级，日板按"同星系取级别最高"进池（本卡会被顶掉）
    name: '深渊之门卫队',
    foeHpOverride: 540, // P1 微调轮（2026-09-06）：C 段墙点（kite+僚）中位 ~50s
    foeSpeedMps: 234, // 敌速上调（2026-09-09 船长：推进器翻倍后按战术分工锚定中高段）kite ×1.35（旧 173）
    galaxyId: 'galaxy-abyss',
    threat: 45,
    tactic: 'kite',
    defProfile: 'shield',
    escorts: 1,
    dmgMix: { plasma: 10 }, // **纯能量**（2026-09-10 船长：能量卡不再走混伤——光束必中、威力由远端衰减单独控）
    foeFalloff: 0.1, // 远端**威力**衰减单独调（2026-09-10 船长，原稿 0.35 → 改 0.1）：能量走 beamPowerFactor，远端威力 = 1−(1−0.1)×0.8 = **×0.28**（缺省 0.30 时 ×0.44）
    foeShotDmg: 45, // **直接写基础伤害**（2026-09-10 船长：「直接调整基础伤害不行吗」）——本卡"威胁份额 ×0.8×4.0s"推得的基础单发 = **90**，本值直接定成 45（= 等效系数 0.50）。
    // 为什么是 45：两端配装对照实测（灰鲭鲨 4×动能MK2 中位）——**只堆主系(动能) 0% / 全堆能量抗 100%·残血 43%**，
    // 即"不堆对应抗性打不过、换了能量抗件稳过"，是本批唯一真正奖励**抗性取向**的卡；90（不回退）时两端都 0%。
    // 2026-09-10 船长：**原 0.35（逐卡等效回退倍率口）已移除**，改由本值直写；该字段已于 2026-09-11 整体退休。
    standingReq: 6,
    standingGain: 2,
    rewardIsk: 160_000,
    loot: [],
    combatSeconds: 75,
    description: '深渊之门常年有人值守，也常年需要民间火力分担防务。协会常驻悬赏：按次结算，声望仅首胜授予。',
  },
  {
    id: 'ano-titan-wreck',
    dmgMix: { kinetic: 8, plasma: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'E', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '泰坦残骸', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：船长 2026-09-10 定「E 族两张都设为 3」
    name: '泰坦残骸勘探',
    foeHpOverride: 1585, // P1 微调轮（2026-09-06）：C 段灰鲭鲨4MK2 中位 ~60s
    foeSpeedMps: 410, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：brawl **1.40×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 374（09-09 段参考船口径 ×1.18）
    foeHitRate: 0.65, // 低安敌人命中率 +10（2026-09-09 船长定；原低命中特例 0.55——远古残骸老化自动炮台，单发重但失准）
    galaxyId: 'galaxy-abyss',
    threat: 60,
    tactic: 'brawl',
    defProfile: 'armor',
    escorts: 1,
    standingReq: 8,
    standingGain: 3,
    rewardIsk: 300_000,
    loot: [],
    combatSeconds: 90,
    description: '一具远古泰坦残骸静卧深渊航道，协会长期征集武装护航下的勘探与清剿——击退守墓编队，赏金照发。',
  },
  {
    id: 'ano-auro-raiders',
    foeFamily: 'E', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '奥罗武装残骸', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：船长 2026-09-10 定「E 族两张都设为 3」
    name: '奥罗武装残骸群',
    foeHpOverride: 1740, // P1 微调轮（2026-09-06）：C 段灰鲭鲨4MK2 中位 ~66s
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 412, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：brawl **1.41×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 375（09-09 段参考船口径 ×1.18）
    galaxyId: 'galaxy-auro',
    threat: 62,
    tactic: 'brawl',
    defProfile: 'armor',
    escorts: 2,
    dmgMix: { kinetic: 8, plasma: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 8,
    standingGain: 3,
    rewardIsk: 310000,
    loot: [],
    combatSeconds: 100,
    description: '奥罗荒环的武装残骸会被风暴反复激活，协会的猎杀令因此常年有效：按次结算，可反复接取。',
  },
  {
    id: 'ano-starcore-boss',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '星髓虫群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：C 族次强（星髓迷宫）
    name: '星髓虫群', // 2026-09-10 船长：与 C 族窝点档位词（虫巢/隐秘孵化地）冲突，改名（id 不变）
    foeHpOverride: 1530, // P1 重标（2026-09-06 定值，船长 2026-09-10 终审）：D 段灰鲭鲨4MK2 中位 ~80s
    foeSpeedMps: 420, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：brawl **1.43×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 409（09-09 段参考船口径 ×1.18）
    galaxyId: 'galaxy-starcore',
    threat: 72,
    tactic: 'brawl',
    defProfile: 'armor',
    escorts: 2,
    dmgMix: { plasma: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    // 2026-09-10 船长：「两处伤害倍率都移除」——本卡原挂 0.35（能量光束必中后的等效回退），现撤除；
    // 该字段已于 2026-09-11 **整体退休**（单发一律按威胁链实际推导值算）。
    standingReq: 10,
    standingGain: 3,
    rewardIsk: 490000,
    loot: [],
    combatSeconds: 100,
    description: '星髓迷宫深处有东西在筑巢。协会将它列入最高级长期悬赏：进去的人要自己数着命回来。',
  },

  // ── 星图拓展（V12 深空悬赏：20 星系网络的远端目标） ──
  {
    id: 'ano-cinder-siege',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'G', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '烬火围攻军', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 1, // 窝点地图级别（1 = 只出外围档）：G 族最弱（烬火星区，威胁 42、奖金 15 万）
    name: '烬火围攻战',
    foeHpOverride: 1585, // P1 微调轮（2026-09-06）：C 段灰鲭鲨4MK2 中位 ~48s
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 307, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：orbit **1.05×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 282（09-09 段参考船口径 ×1.18）
    galaxyId: 'galaxy-cinder',
    threat: 42,
    tactic: 'orbit', // 2026-09-11 显式化：原靠 `anomaly.tactic ?? 'orbit'` 缺省值生效——那是个静默陷阱（谁动默认值，这几张卡会集体静默变战术）
    standingReq: 6,
    standingGain: 2,
    rewardIsk: 150_000,
    loot: [],
    combatSeconds: 85,
    description: '烬火星区的防线战事常年不断，协会长期悬赏民间火力增援——击退一次围攻编队，结算一次赏金。',
  },
  {
    id: 'ano-echo-haunt',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'G', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '回音残舰', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 2, // 窝点地图级别（2 = 到核心档）：回音荒区
    name: '回音残舰',
    foeHpOverride: 2035, // P1 微调轮（2026-09-06）：C 段灰鲭鲨4MK2 中位 ~56s
    foeSpeedMps: 316, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：orbit **1.08×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 288（09-09 段参考船口径 ×1.18）
    galaxyId: 'galaxy-echo',
    threat: 52,
    tactic: 'orbit', // 2026-09-11 显式化（原靠缺省值生效）
    standingReq: 6,
    standingGain: 2,
    rewardIsk: 170000,
    loot: [],
    combatSeconds: 110,
    description: '回音荒区的残舰群会不断“复活”，协会认为是残余自动化程序作祟。长期清剿令按次结算。',
  },
  {
    id: 'ano-nadir-static',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'G', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '天底封锁军', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：G 族最强（天底静区，威胁 66、奖金 35 万）
    name: '天底静区封锁',
    foeHpOverride: 2040, // P1 重标（2026-09-06 定值，船长 2026-09-10 终审）：D 段灰鲭鲨4MK2 中位 ~74s
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 327, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：orbit **1.12×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 316（09-09 段参考船口径 ×1.18）
    galaxyId: 'galaxy-nadir',
    threat: 66,
    tactic: 'orbit', // 2026-09-11 显式化（原靠缺省值生效）
    standingReq: 9,
    standingGain: 3,
    rewardIsk: 350000,
    loot: [],
    combatSeconds: 100,
    description: '天底是条死胡同，也是流亡舰队最后的据点。协会长年封锁此区，悬赏每一次突破防线的清剿。',
  },
  {
    id: 'ano-maw-hunt',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '噬口猎食群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：C 族最强（星噬之口，威胁 80、奖金 85 万）
    name: '噬口猎杀令',
    foeHpOverride: 1844, // 2026-09-10 船长（族系改判）：改 brawl 后按**时长口径**重标——中位参考行打完 = 该段 D(T)=67s（实测 78s）；改判前 4000（orbit 口径，改判后要 131s 偏长）
    // 2026-09-10 船长（族系改判）：**orbit → brawl**（C 族＝有机曲线 + 螯颚 + 酸液喷吐器，「噬口」应贴脸吞噬）
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 426, // 敌速重标（2026-09-10 船长）：改判 brawl 后按 brawl 口径 **1.46×** 基准船（长尾鲨级 272 → 战斗机动 165）；改判前 338（orbit 1.15×）
    waves: [
      { units: 2, hpShare: 0.5 },
      { units: 1, hpShare: 0.5 },
    ], // 多波次（2026-09-09 船长拍板首批：低安顶段 90~150s 无喘息；docs/design/wave-battles-20260909.md）
    galaxyId: 'galaxy-maw',
    threat: 80,
    tactic: 'brawl', // 2026-09-10 船长（族系改判）：**orbit（原缺省）→ brawl**（C 族＝螯颚/酸液喷吐的贴脸生物）
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 11,
    standingGain: 4,
    rewardIsk: 850000,
    loot: [],
    combatSeconds: 160,
    description: '星噬之口吞噬过太多舰队。协会悬赏一切能削弱其守军的行动——常设令，可反复接取。',
  },
  {
    id: 'ano-vault-sentinel',
    dmgMix: { kinetic: 8, plasma: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '穹顶守卫', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：D 族最强（穹顶墓园，威胁 96、奖金 150 万）
    name: '穹顶守卫',
    foeHpOverride: 5600, // 巡洋时代复调轮 r1（2026-09-09）：E 段按锤头鲨炮巡重标——中位 55s→目标 ~75s（原 4100）
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 351, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：orbit **1.20×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 356（09-09 段参考船口径 ×1.18）
    waves: [
      { units: 2, hpShare: 0.35 },
      { units: 2, hpShare: 0.35 },
      { units: 1, hpShare: 0.3 },
    ], // 多波次（2026-09-09 船长拍板首批：低安顶段 90~150s 无喘息；docs/design/wave-battles-20260909.md）
    galaxyId: 'galaxy-vault',
    threat: 96,
    tactic: 'orbit', // 2026-09-11 显式化（原靠缺省值生效）
    standingReq: 13,
    standingGain: 4,
    rewardIsk: 1500000,
    loot: [],
    combatSeconds: 55,
    description: '穹顶墓园的守墓舰队是现存最古老的武装力量，协会将其列为全星域最高悬赏——无人知晓它们为何仍在巡弋。',
  },
  {
    id: 'ano-voidedge-warden',
    dmgMix: { kinetic: 8, plasma: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '虚海守望者', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 2, // 窝点地图级别（2 = 到核心档）：虚海边缘（威胁 88、奖金 110 万）
    name: '虚海守望者',
    foeHpOverride: 4300, // 巡洋时代复调轮 r1（2026-09-09）：E 段按锤头鲨炮巡重标——中位 33s→目标 ~60s（原 2450）
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 345, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：orbit **1.18×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 329（09-09 段参考船口径 ×1.18）
    waves: [
      { units: 2, hpShare: 0.35 },
      { units: 2, hpShare: 0.35 },
      { units: 1, hpShare: 0.3 },
    ], // 多波次（2026-09-09 船长拍板首批：低安顶段 90~150s 无喘息；docs/design/wave-battles-20260909.md）
    galaxyId: 'galaxy-voidedge',
    threat: 88,
    tactic: 'orbit', // 2026-09-11 显式化（原靠缺省值生效）
    standingReq: 12,
    standingGain: 4,
    rewardIsk: 1100000,
    loot: [],
    combatSeconds: 60,
    description: '虚海边缘的守望者只对强敌回应。协会常年保留这份最高级通缉，等待能活着带回战报的人。',
  },
  // ══════════ V16.1 内容补充：为空缺星系添加的长期悬赏 ══════════
  {
    id: 'ano-harbor-escort',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    foeFamily: 'B', // 敌族（与美术层 FOE_ART 族字母同源）
    // ⚠ **`lairCore` 已退役（2026-09-11 船长裁决「B 族没有窝点、排除出赏金范围」）**：
    // 本卡曾带 `lairCore: '新港拾荒团'`，按"方案 2"删除字段（数据层干净）——
    // **旧档兼容去向 = `RETIRED_LAIR_CARD_IDS` 白名单**（`docs/design/foe-faction-b-scavenger-20260911.md` §六；
    // 让旧档里已获得的 `wreck-rare-ano-harbor-escort` 仍能被识别与开箱）。**不是漏标，勿加回来**（契约会拦）。
    name: '新港商路护航令',
    // B 族落码批（2026-09-11 船长七裁决）：迁入**舰级路径**（拾荒武装艇 ×1）。
    // 基准卡 = 演习场驱逐令（T6），本卡按**精确倍率**复现原建档值：血 75（75/22）、单发 23（23/14）、
    // 射程 1~2200 与舰级相同（无需覆写）；卡面**装甲型**、构成 **8:2** 均与舰级基准不同 → 条目上覆写。
    // 速度：旧绝对 337 → **306**（同舰级 0.90；船长「速度偏慢」——**有意改慢**，本卡不再比教学卡更快）。
    ships: [
      {
        ship: FOE_SCAV_SKIFF,
        hpMul: 75 / 22, // = 原 foeHpOverride 75
        dmgMul: 23 / 14, // = 原推导单发 23（kinetic 18 + explosive 5）
        split: foeLayerSplit('armor'), // 卡面装甲型（舰级基准是均衡型）
        dmgMix: { kinetic: 8, explosive: 2 }, // 本卡 8:2（舰级基准是纯动能）
      },
    ],
    galaxyId: 'galaxy-harbor',
    threat: 10,
    tactic: 'orbit', // 船长：B 族战术统一 orbit（原 brawl）
    defProfile: 'armor',
    standingReq: 1,
    standingGain: 1,
    rewardIsk: 6_400, // 2026-09-06 船长复核：8,000→6,400（−20%，新手区第二张单收益收口）
    loot: [],
    combatSeconds: 20,
    description: '新港走廊的商路劫案从未断过。协会长期悬赏护航协防：击退小型劫掠艇按次结算——新手练兵的第一张常驻单。',
  },
  {
    id: 'ano-shard-bandits',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '碎晶劫匪', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 1, // 窝点地图级别（1 = 只出外围档）：A 族第二弱的近处图（碎晶带）
    name: '碎晶带劫匪通缉',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 海盗快艇 ×3**（本卡的快艇是"提速变体"，
    // 保留试点期的 `speedMul 377/351` 与 `rangeMul 2273/2215`：它们乘在新的 −15% 基准与 1.15 基准之上）。
    // 血：285 → 头目 171（171÷360）、每杂鱼 285×40%÷3 = 38（38÷150）。
    // 火力：名义总 DPS = 20 × 0.8 × 1.6 = **25.6** → 头目 15.36 / 每杂鱼 3.4133；
    //   单发（动能主系）→ 头目 15.36×4×0.62/0.9 = 42.3253 → **42**，杂鱼 3.4133×4×0.62/0.85 = 9.9589 → **10**；
    //   Σ = 72，名义 Σ = 72.2020 → **取整偏差 0**。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (285 * 3) / 5 / FOE_SHIP_PIRATE_WARLORD.hp, // = 171/360
        dmgMul: 42 / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // = 42/(56×1.6)
        // 头目缺省构成 = 动能 8:2，与卡面一致（缴获改装的实弹），故**不另写** `dmgMix`
      },
      {
        ship: FOE_SHIP_PIRATE_SKIFF,
        count: 3,
        hpMul: (285 * 2) / 15 / FOE_SHIP_PIRATE_SKIFF.hp, // = 38/150
        dmgMul: 10 / (FOE_SHIP_PIRATE_SKIFF.shotDmg * A_MULTI_SHIP_COMP), // = 10/(28×1.6)
        speedMul: 377 / 351,
        rangeMul: 2273 / 2215,
        dmgMix: { kinetic: 8, explosive: 2 },
      },
    ],
    galaxyId: 'galaxy-shard',
    threat: 20,
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    tactic: 'brawl',
    defProfile: 'armor',
    standingReq: 2,
    standingGain: 1,
    rewardIsk: 25_000,
    loot: [],
    combatSeconds: 25,
    description: '碎晶带的晶尘里藏着一伙专劫曦棱晶货船的惯匪。通缉长期有效，可反复接取。',
  },
  {
    id: 'ano-lantern-saboteurs',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '信标猎手', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 2, // 窝点地图级别（2 = 到核心档）：灯塔长廊
    name: '信标猎手悬赏',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠护卫舰 ×3**。
    // 头目舰缺省是 brawl 贴脸，本卡是 orbit 环绕 → 用条目 `tactic` **覆写**（船长「头目可配多战术」）。
    // 血：365 → 头目 219（219÷360）、每杂鱼 365×40%÷3 = 48.6667（48.6667÷365，Σ 精确 = 365）。
    // 火力：名义总 DPS = 22 × 0.8 × 1.6 = **28.16** → 头目 16.896 / 每杂鱼 3.7547；
    //   单发（动能主系）→ 头目 16.896×4×0.62/0.9 = 46.5579 → **47**，杂鱼 3.7547×4×0.62/0.85 = 10.9548 → **11**；
    //   Σ = 80，名义 Σ = 79.4222 → **取整偏差 +1**（余数 1 落在 3 艘杂鱼上无法整分，如实记偏差）。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (365 * 3) / 5 / FOE_SHIP_PIRATE_WARLORD.hp, // = 219/360
        dmgMul: 47 / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // = 47/(56×1.6)
        // 血型随卡走（船长裁决①）：卡面 均衡 → 头目条目覆写为均衡型（头目舰本体是装甲型）
        split: foeLayerSplit('balanced'),
        // 射程多重方案（船长裁决③）：头目原射程带 1~2210m，在本卡 3199m 的实际交战距离下
        // **一次都没开火**（探针实测 foe-0 = 0 次）⇒ 按「同卡同带」覆写为杂鱼（劫掠护卫舰）的射程带
        rangeMinM: FOE_SHIP_PIRATE_CORVETTE.rangeMinM,
        rangeMaxM: FOE_SHIP_PIRATE_CORVETTE.rangeMaxM,
        tactic: 'orbit',
        // 头目缺省构成 = 动能 8:2，与卡面一致，故**不另写** `dmgMix`
      },
      {
        ship: FOE_SHIP_PIRATE_CORVETTE,
        count: 3,
        hpMul: (365 * 2) / 15 / FOE_SHIP_PIRATE_CORVETTE.hp, // = 48.6667/365
        dmgMul: 11 / (FOE_SHIP_PIRATE_CORVETTE.shotDmg * A_MULTI_SHIP_COMP), // = 11/(51×1.6)
      },
    ],
    galaxyId: 'galaxy-lantern',
    threat: 22,
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    tactic: 'orbit',
    defProfile: 'balanced',
    standingReq: 2,
    standingGain: 1,
    rewardIsk: 30_000,
    loot: [],
    combatSeconds: 20,
    description: '灯塔长廊的信标阵列屡遭破坏，修复费用高昂。协会悬赏猎杀破坏信标的惯犯——本单长期有效。',
  },
  {
    id: 'ano-haze-ambush',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '灰霾伏击团', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 2, // 窝点地图级别（2 = 到核心档）：灰霾带
    name: '灰霾伏击团清剿令',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠狙击舰 ×3**。
    // 原 `escorts: 1` 的**僚机条目取消**（船长 ①：灰霾/蜃影的 escort 条目改为上述编成）——
    // 三艘狙击舰现在都是**主体**（tag `w0-foe-1..3`），不再挂「轻装」前缀。
    // 头目舰缺省 brawl、本卡 kite → 条目 `tactic: 'kite'` 覆写；头目构成覆写为爆炸 8:2（与卡面一致）。
    // 血：430 → 头目 258（258÷360）、每杂鱼 430×40%÷3 = 57.3333（57.3333÷268.75，Σ 精确 = 430）。
    // 火力：名义总 DPS = 28 × 0.8 × 1.6 = **35.84** → 头目 21.504 / 每杂鱼 4.7787；
    //   单发（爆炸主系）→ 头目 21.504×4×0.62/0.9 = 59.2555 → **59**，杂鱼 4.7787×4×0.62/0.85 = 13.9425 → **14**；
    //   Σ = 101，名义 Σ = 101.0829 → **取整偏差 0**。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (430 * 3) / 5 / FOE_SHIP_PIRATE_WARLORD.hp, // = 258/360
        dmgMul: 59 / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // = 59/(56×1.6)
        split: foeLayerSplit('shield'), // 血型随卡走（船长裁决①）：卡面护盾 → 头目也护盾
        // 射程多重方案（船长裁决③）：头目原 1~2210m 在本卡 3238m 交战距离下 0 次开火（探针实测）
        // ⇒ 同卡同带：覆写为杂鱼（劫掠狙击舰）射程带
        rangeMinM: FOE_SHIP_PIRATE_SNIPER.rangeMinM,
        rangeMaxM: FOE_SHIP_PIRATE_SNIPER.rangeMaxM,
        tactic: 'kite',
        dmgMix: { explosive: 8, kinetic: 2 },
      },
      {
        ship: FOE_SHIP_PIRATE_SNIPER,
        count: 3,
        hpMul: (430 * 2) / 15 / FOE_SHIP_PIRATE_SNIPER.hp, // = 57.3333/268.75
        dmgMul: 14 / (FOE_SHIP_PIRATE_SNIPER.shotDmg * A_MULTI_SHIP_COMP), // = 14/(41×1.6)
      },
    ],
    galaxyId: 'galaxy-haze',
    threat: 28,
    tactic: 'kite',
    defProfile: 'shield',
    dmgMix: { explosive: 8, kinetic: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 3,
    standingGain: 1,
    rewardIsk: 60_000,
    loot: [],
    combatSeconds: 70,
    description: '灰霾带的电离云是天然的伏击场——一伙劫掠团常年盘踞环心航路。协会发布长期清剿令，按次结算。',
  },
  {
    id: 'ano-mirage-hijackers',
    foeFamily: 'A', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '蜃影劫持团', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 3, // 窝点地图级别（3 = 全档）：A 族最强（蜃影星系，威胁 48、奖金 19 万）
    name: '蜃影导航劫持令',
    // A 族数值落地批（2026-09-11）：编成 = **头目舰 ×1 + 劫掠狙击舰 ×3**（本卡是三档的"最强变体"，
    // 保留 `speedMul 235/201` 与 `rangeMul 13667/11316`；原 `escorts: 1` 僚机条目**取消**）。
    // 头目缺省 brawl、本卡 kite → `tactic: 'kite'` 覆写；主系覆写为能量 ⇒ 光束必中（单发不除命中）。
    // 血：560 → 头目 336（336÷360）、每杂鱼 560×40%÷3 = 74.6667（74.6667÷268.75，Σ 精确 = 560）。
    // ⚠ **火力重锚（2026-09-11 船长裁决 = 方案 B + 纸面锚 ×1.2）**：本卡同样**不走威胁曲线**——原口径按
    //   `威胁 × 0.8 × 1.6 = 61.44` 重锚时，把旧有的**逐卡伤害压制倍率（旧 `foeDmgMul` 0.30）**无声取消，
    //   实际火力 11.50 → 61.50（×5.35），实测**从"可打"变成"打不过"**。
    //   **船长裁决：锚回"改造前的实际火力"**（**不恢复 `foeDmgMul`**，用卡上 `dmgMul` 重锚）；
    //   纸面锚点由 ×1.6 下调为 **×1.2**（**难度守恒按「实收」判定**：4 单位 ⇒ 实收 ≈ 纸面 ×0.625，
    //   而本卡改动前只有 2 单位（衰减 ×0.75），故"实收 ≈ 改动前"须纸面 ×`0.75/0.625` = ×1.2）。
    //   → 目标实际火力 = 11.50 × 1.2 = **13.80**；重锚单发（光束，÷4s、60%/40%÷3 后取整）：
    //   头目 0.6×13.80×4 = 33.12 → **33**、每杂鱼 (0.4/3)×13.80×4 = 7.36 → **7**；
    //   Σ = 54 → **纸面 13.50**（目标 13.80，取整 −2.2%）；实收 = 13.50 × 0.625 = **8.44** ≈ 改动前 11.50 的 ×0.73。
    ships: [
      {
        ship: FOE_SHIP_PIRATE_WARLORD,
        hpMul: (560 * 3) / 5 / FOE_SHIP_PIRATE_WARLORD.hp, // = 336/360
        dmgMul: 33 / (FOE_SHIP_PIRATE_WARLORD.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 33/(56×1.6)
        split: foeLayerSplit('shield'), // 血型随卡走（船长裁决①）：卡面护盾 → 头目也护盾
        // 射程多重方案（船长裁决③）：头目原 1~2210m 在本卡 3809m 交战距离下 0 次开火（探针实测）
        // ⇒ 同卡同带（与杂鱼同式的变体倍率推导，**不手抄数字**）
        rangeMinM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMinM * MIRAGE_RANGE_MUL),
        rangeMaxM: Math.round(FOE_SHIP_PIRATE_SNIPER.rangeMaxM * MIRAGE_RANGE_MUL),
        tactic: 'kite',
        dmgMix: { plasma: 8, kinetic: 2 },
      },
      {
        ship: FOE_SHIP_PIRATE_SNIPER,
        count: 3,
        hpMul: (560 * 2) / 15 / FOE_SHIP_PIRATE_SNIPER.hp, // = 74.6667/268.75
        dmgMul: 7 / (FOE_SHIP_PIRATE_SNIPER.shotDmg * A_MULTI_SHIP_COMP), // ×1.2 锚 = 7/(41×1.6)
        speedMul: 235 / 201,
        rangeMul: MIRAGE_RANGE_MUL,
        dmgMix: { plasma: 8, kinetic: 2 },
      },
    ],
    galaxyId: 'galaxy-mirage',
    threat: 48,
    tactic: 'kite',
    defProfile: 'shield',
    dmgMix: { plasma: 8, kinetic: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 5,
    standingGain: 2,
    rewardIsk: 190_000,
    loot: [],
    combatSeconds: 100,
    description: '蜃影的引力透镜是天然的埋伏场，海盗借此劫持迷航商船。协会长期悬赏清除这些导航劫持者。',
  },
  {
    id: 'ano-chasm-aberrations',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '裂谷畸变群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: 2, // 窝点地图级别（2 = 到核心档）：裂谷深带
    name: '裂谷畸变体猎杀令',
    foeHpOverride: 1815, // P1 微调轮（2026-09-06）：C 段灰鲭鲨4MK2 中位 ~62s
    foeHitRate: 0.95, // 低安敌人命中率 +10（2026-09-09 船长定：全部低安非光束敌 +0.1，原 0.85）
    foeSpeedMps: 408, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：brawl **1.39×** 基准船（长尾鲨级 272 → 战斗机动 165）；原 372（09-09 段参考船口径 ×1.18）
    galaxyId: 'galaxy-chasm',
    threat: 58,
    tactic: 'brawl',
    defProfile: 'balanced',
    escorts: 1,
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: 7,
    standingGain: 3,
    rewardIsk: 250_000,
    loot: [],
    combatSeconds: 100,
    description: '裂谷深带的引力畸变催生出集群异形，威胁深层矿道。协会将其列为长期高危猎杀令。',
  },

  /* ═══ B1 低安遭遇战模板（hidden：不进悬赏目录；threat 档位供遭遇强度就近匹配） ═══ */
  {
    id: 'enc-pirate-1',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '流窜海盗快艇',
    galaxyId: 'galaxy-hub',
    threat: 10,
    foeSpeedMps: 281, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：orbit **0.96×** 基准船（长尾鲨级 272 → 战斗机动 165）；原按公式算得 176
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 20,
    tactic: 'orbit',
    hidden: true,
    description: '低安遭遇模板：小股流窜海盗（隐藏，不出现在悬赏目录）。',
  },
  {
    id: 'enc-pirate-2',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '伏击劫掠队',
    galaxyId: 'galaxy-hub',
    threat: 22,
    foeSpeedMps: 291, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：orbit **0.99×** 基准船（长尾鲨级 272 → 战斗机动 165）；原按公式算得 205
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 30,
    tactic: 'orbit',
    escorts: 1,
    hidden: true,
    description: '低安遭遇模板：中等伏击队（隐藏）。',
  },
  {
    id: 'enc-pirate-3',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '狂徒巡逻编队',
    galaxyId: 'galaxy-hub',
    threat: 40,
    foeSpeedMps: 394, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：brawl **1.35×** 基准船（长尾鲨级 272 → 战斗机动 165）；原按公式算得 305
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 40,
    tactic: 'brawl',
    escorts: 2,
    hidden: true,
    description: '低安遭遇模板：重装狂徒编队（隐藏）。',
  },
  {
    id: 'enc-pirate-4',
    dmgMix: { kinetic: 8, explosive: 2 }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    name: '深空屠夫舰队',
    galaxyId: 'galaxy-hub',
    threat: 70,
    foeSpeedMps: 418, // 敌速重标（2026-09-10 船长：固定锚定 + 中位船基准）：brawl **1.43×** 基准船（长尾鲨级 272 → 战斗机动 165）；原按公式算得 346
    standingReq: 0,
    standingGain: 0,
    rewardIsk: 0,
    loot: [],
    combatSeconds: 60,
    tactic: 'brawl',
    escorts: 2,
    hidden: true,
    description: '低安遭遇模板：高危屠夫舰队（隐藏）。',
  },
]
/** 构建异常点目录（含 B3.1 敌群回收特色合并，2026-09-06） */
export function buildAnomalyCatalog(): ReadonlyMap<string, AnomalyDef> {
  return new Map(ANOMALIES.map((a) => [a.id, withRecycleFlavor(a)]))
}
/** 合并回收特色后的全量目录（桌面端 UI 目录同源；2026-09-06） */
export const ANOMALIES_FLAVORED: readonly AnomalyDef[] = ANOMALIES.map(withRecycleFlavor)
