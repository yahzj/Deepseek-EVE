/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf, foeLayerSplit } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_D_LONGSHIP, FOE_D_GHOST, FOE_D_STASIS } from '../../foe-ships'
import { COMP_MUL } from './constants'

export const ANOMALY_ENTRY_6: AnomalyDef =
  {
    id: 'ano-gravekeeper',
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '坟场守墓者', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "lairLevel"), // 窝点地图级别（2 = 到核心档）：暗星坟场（威胁 87、奖金 110 万）
    name: '坟场守墓者', // 2026-09-11 船长批「卡名可以更换」：坟场守墓人 → **坟场守墓者**（与窝点词 lairCore 统一；P-30 收口）
    // D 族落码批（2026-09-11 船长「对悬赏进行敌人配置」）：迁入**舰级路径**（守墓长舰 = T3 巡洋·中程）。
    // 船长三定：档位「1 驱逐 2 巡洋」· 战法「守墓长舰按中程」（沿用 orbit）· 速度「按正常算」= **258**。
    // **火力对齐**（原任务 P-11）：主系 **动能 → 等离子（能量）** 8 : 动能 2（副系按族签名表
    //   `FOE_SUB_DMG.D = 等离子→动能→爆炸` 顺位）+ **`beam` 光束必中**（「靠必中与射程立身」）。
    // **守恒（实测基准，非卡面值）**：改造前逐单位血 **1,980 ×2 + 1,620**（旧多波路径下"波内每个单位拿满波血"
    //   ⇒ 实际总血 **5,580**，不是 `foeHpOverride` 的 3,600）、单发 **184**、射程 562~7,391、血型装甲 —— 逐项保留。
    // **单发 184 → 175**：×0.95 **吸收"必中"带来的命中增益**，使**实收/轮守恒**（旧链 `184×0.95 ≈ dps×4×0.62`）；
    //   保留的难度变化只有"层位克制"本身（动能对盾 ×1.5 → 等离子对盾 ×1.25 / 对甲 ×0.5 → ×1.0）。
    // N = 3 ⇒ 补偿 `6/4`，卡上 `dmgMul` 把它除掉。血量旧账（P-03）本批**不动**，等六组读数再定。
    // 船长 2026-09-11 二次裁定（**削减编成**）：「坟场守墓者削减到**一波 2 艘船**」。
    // ⇒ 单波 **守墓长舰 ×2**（原 2 波 2+1 = 3 艘）；**每艘的属性不变**（血 1,980 / 单发 175）
    //   ⇒ 本卡总血 **5,580 → 3,960**、总单发 552 → 350（本轮是船长指定的**强度削减**，不再是守恒口径）。
    // N = 2 ⇒ 补偿由 `6/4` 变 **`4/3`**，卡上 `dmgMul` 随之重算。
    ships: [
      {
        ship: FOE_D_LONGSHIP,
        count: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_hpMul_input0") / FOE_D_LONGSHIP.hp, // 每艘 1,980（与削减前同值）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_dmgMul_input0") / (FOE_D_LONGSHIP.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-gravekeeper", "ships_0_dmgMul_input1"))), // 每艘单发 175
      },
    ],
    waves: [{ units: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "waves_0_hpShare") }], // 单波；⚠ `units` 之和 3 → **2** ⇒ 该星系残骸注入量的
    //   敌人数因子 1.6 → 1.4（−12.5%）—— 这是"削减编成"的**必然连带**，已登记（回收池若需重标另议）
    galaxyId: 'galaxy-grave',
    threat: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 中程（2026-09-10 船长族系改判 brawl → orbit；本次沿用）
    defProfile: 'armor',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "dmgMix_kinetic") }, // 混伤 8:2：**主系能量**（2026-09-11 对齐设定「以能量武器为主」）
    standingReq: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-gravekeeper", "combatSeconds"),
    description: '暗星坟场的守墓舰队从不轮换，协会对它的通缉令也从未撤销：击退一次，结算一次。',
  }

export const ANOMALY_ENTRY_7: AnomalyDef =
  {
    id: 'ano-ghost-signal',
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '幽灵舰', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "lairLevel"), // 窝点地图级别（1 = 只出外围档）：D 族最弱（红环航道，奖金 16.5 万）
    // 注：同星系的 A 族「赤潮劫掠舰队」为 3 级，日板按"同星系取级别最高"进池（本卡会被顶掉）
    name: '幽灵舰信号',
    // D 族落码批（2026-09-11 船长「对悬赏进行敌人配置」）：迁入**舰级路径**（幽灵舰 = T2 驱逐）。
    // 船长三定：档位「1 驱逐 2 巡洋」· 战法「**幽灵舰为中程**」（**kite → orbit**）· 速度「**提速到 110%**」= **325**。
    // **守恒（实测基准）**：改造前逐单位血 **346.875（主）+ 208.125（僚机）**（Σ 555）、单发 **67 + 40**、
    //   命中 0.85、射程 1,752~13,432、血型护盾 —— 血/单位数逐字保留；**僚机改主体**（船长「不保留僚机」）。
    // **改动**：主系 爆炸 → **等离子（能量）** 8 : 动能 2 + **`beam` 必中**；单发 ×0.95 = **64 / 38**（实收守恒）；
    //   射程带收成 **中程 562~7,000**（原 13,432 是旧 kite 口径，随"幽灵舰为中程"的裁定收窄）。
    // ⚠ **本卡不写 `waves`**：单波，而 `bountyEnemyCount` 数 `waves[].units` 之和——不写 = 仍是 **1**（与改造前一致）
    //   ⇒ **不动红环航道的残骸密度**（C 族那次的连带项教训，本批两处都避开）。
    ships: [
      {
        ship: FOE_D_GHOST,
        hpMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_0_hpMul_input0") / FOE_D_GHOST.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_0_dmgMul_input0") / (FOE_D_GHOST.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_0_dmgMul_input1"))),
      },
      {
        ship: FOE_D_GHOST,
        hpMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_1_hpMul_input0") / FOE_D_GHOST.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_1_dmgMul_input0") / (FOE_D_GHOST.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-ghost-signal", "ships_1_dmgMul_input1"))),
      },
    ],
    galaxyId: 'galaxy-redring',
    threat: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 中程（船长「幽灵舰为中程」；原 kite）
    defProfile: 'shield',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "dmgMix_kinetic") }, // 混伤 8:2：**主系能量**（2026-09-11 对齐设定「以能量武器为主」）
    standingReq: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-ghost-signal", "combatSeconds"),
    description: '一桩悬了许久的疑案：幽灵舰定期在红环深处现身又消失。协会对每一次成功接触都发放调查赏金——它到底是什么，至今没人说清。',
  }

export const ANOMALY_ENTRY_17: AnomalyDef =
  {
    id: 'ano-vault-sentinel',
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '穹顶守卫', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "lairLevel"), // 窝点地图级别（3 = 全档）：D 族最强（穹顶墓园，威胁 110、奖金 150 万）
    name: '穹顶守卫',
    // D 族落码批（2026-09-11 船长「对悬赏进行敌人配置」）：迁入**舰级路径**（静滞卫舰 = T3 巡洋·**远程**）。
    // 船长三定：档位「1 驱逐 2 巡洋」· 战法「**静滞卫舰改为远程**」（**orbit → kite**）· 速度「只有正常的 50%」= **129**
    //   —— 全族最慢：它不追你，只是从 12 km 外一直点名（「守墓者从来不需要追人」的数字事实）。
    // **守恒（实测基准）**：改造前逐单位血 **1,960 ×4 + 1,680**（实际总血 **9,520**，非 `foeHpOverride` 的 5,600）、
    //   单发 **200**、射程 584~7,677、血型均衡 —— 逐项保留。
    // **改动**：主系 动能 → **等离子（能量）** 8 : 动能 2 + **`beam` 必中**；单发 ×0.95 = **190**（实收守恒）；
    //   射程带 → **562~12,000**（远程档族内最长 = 守墓者长炮的招牌射程）。
    // 船长 2026-09-11 二次裁定（**削减编成 + 混编**）：「穹顶守卫削减到**1 波 2 静滞卫舰 + 1 守墓长舰**」。
    // ⇒ 单波 **静滞卫舰 ×2 + 守墓长舰 ×1**（原 3 波 2+2+1 = 5 艘，全是静滞卫舰）。
    // **两舰级按同一"卡片血量倍率"伸缩**（`k = 1,960 / 1,170`）：静滞卫舰每艘 **1,960**、
    //   守墓长舰每艘 **1,080 × k = 1,809.23**（同 k ⇒ 各舰级仍按自己的档案锚成比例，不是一律 1,960）。
    // 单发同款：静滞卫舰每艘 **190**、守墓长舰每艘 **161**（= 105 × `190/124`，同一卡级系数）。
    // ⇒ 总血 **9,520 → 5,729.23**、总单发 1,000 → 541。N = 5 → **3** ⇒ 补偿 `10/6` → **`6/4`**。
    // 静滞卫舰排在**首位** ⇒ `foes[0]` 仍是 12 km 带 ⇒ **期望交距 10,284 m 不变**（远程档站姿不变）。
    ships: [
      {
        ship: FOE_D_STASIS,
        count: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_hpMul_input0") / FOE_D_STASIS.hp, // 每艘 1,960（与削减前同值）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_dmgMul_input0") / (FOE_D_STASIS.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_0_dmgMul_input1"))), // 每艘单发 190
      },
      {
        ship: FOE_D_LONGSHIP,
        count: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_count"),
        // 同一条"卡片血量倍率" k = 1960/1170 ⇒ 1,080 × k = 1,809.23（各舰级按自己的档案锚成比例）
        hpMul: (enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_hpMul_input0") * (enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_hpMul_input1") / FOE_D_STASIS.hp)) / FOE_D_LONGSHIP.hp,
        dmgMul: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_dmgMul_input0") / (FOE_D_LONGSHIP.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "ships_1_dmgMul_input1"))), // 每艘单发 161（= 105 × 190/124）
        split: foeLayerSplit('balanced'), // 血型随卡走（守墓长舰舰级缺省是装甲型）
        tactic: 'kite', // 随卡走（本卡是远程档；守墓长舰舰级缺省为 orbit）
      },
    ],
    waves: [{ units: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "waves_0_hpShare") }], // 单波；⚠ `units` 之和 5 → 3 ⇒ 该星系注入量的敌人数因子 2.0 → 1.6（−20%）
    galaxyId: 'galaxy-vault',
    threat: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'kite', // 远程（船长「静滞卫舰改为远程」；原 orbit）
    defProfile: 'balanced', // 显式化（原缺省值生效）
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "dmgMix_kinetic") }, // 混伤 8:2：**主系能量**（2026-09-11 对齐设定）
    standingReq: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-vault-sentinel", "combatSeconds"),
    description: '穹顶墓园的守墓舰队是现存最古老的武装力量，协会将其列为全星域最高悬赏——无人知晓它们为何仍在巡弋。',
  }

export const ANOMALY_ENTRY_18: AnomalyDef =
  {
    id: 'ano-voidedge-warden',
    // D 族落码批（2026-09-11 船长「对悬赏进行敌人配置」）：迁入**舰级路径**（守墓长舰 = T3 巡洋·中程）。
    // **守恒（实测基准）**：改造前逐单位血 **1,505 ×4 + 1,290**（实际总血 **7,310**，非 `foeHpOverride` 的 4,300）、
    //   单发 **184**、射程 562~7,391、血型**均衡** —— 逐项保留；本卡与坟场守墓者**共用同一舰级**，
    //   差别落在**卡面血型**（本卡均衡 / 坟场装甲，用条目 `split` 覆写）与**编成规模**（5 单位 vs 3 单位）上
    //   —— 这正是"D 族四张卡平级、只按地点分"的写法。
    // **改动**：主系 动能 → **等离子（能量）** 8 : 动能 2 + **`beam` 必中**；单发 ×0.95 = **175**（实收守恒）。
    // 船长 2026-09-11 二次裁定（**削减编成**）：「虚海守望者削减到**1 波 3 艘船**」。
    // ⇒ 单波 **守墓长舰 ×3**（原 3 波 2+2+1 = 5 艘）；**每艘属性不变**（血 1,505 / 单发 175）
    //   ⇒ 总血 **7,310 → 4,515**、总单发 920 → 525。N = 5 → **3** ⇒ 补偿 `10/6` → **`6/4`**。
    ships: [
      {
        ship: FOE_D_LONGSHIP,
        count: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_count"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_hpMul_input0") / FOE_D_LONGSHIP.hp, // 每艘 1,505（与削减前同值）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_dmgMul_input0") / (FOE_D_LONGSHIP.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "ships_0_dmgMul_input1"))), // 每艘单发 175
        split: foeLayerSplit('balanced'), // 血型随卡走（舰级缺省是装甲型）
      },
    ],
    waves: [{ units: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "waves_0_hpShare") }], // 单波；⚠ `units` 之和 5 → 3 ⇒ 该星系注入量的敌人数因子 2.0 → 1.6（−20%）
    foeFamily: 'D', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '虚海守望者', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "lairLevel"), // 窝点地图级别（2 = 到核心档）：虚海边缘（威胁 103、奖金 110 万）
    name: '虚海守望者',
    galaxyId: 'galaxy-voidedge',
    threat: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "threat"),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'orbit', // 中程（族规全远程；本卡沿用）
    defProfile: 'balanced', // 显式化（原缺省值生效）
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "dmgMix_plasma"), kinetic: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "dmgMix_kinetic") }, // 混伤 8:2：**主系能量**（2026-09-11 对齐设定）
    standingReq: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-voidedge-warden", "combatSeconds"),
    description: '虚海边缘的守望者只对强敌回应。协会常年保留这份最高级通缉，等待能活着带回战报的人。',
  }
