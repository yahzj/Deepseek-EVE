/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf, foeLayerSplit } from '@whale/core'
import bountiesParameters from '../../static/bounties.json'
import { FOE_ALIEN_STARCORE, FOE_ALIEN_STARCORE_ADULT, FOE_ALIEN_RIFT, FOE_ALIEN_MAW } from '../../foe-ships'
import { COMP_MUL, MAW_TOTAL_HP, MAW_MINION_SHARE, MAW_TOTAL_DMG, MAW_BOSS_SHARE } from './constants'

export const ANOMALY_ENTRY_8: AnomalyDef =
  {
    id: 'ano-abyss-guard',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '深渊潜伏群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "lairLevel"), // 窝点地图级别（1 = 只出外围档）：C 族最弱（深渊之门，奖金 16 万）
    // 注：同星系的 E 族「泰坦残骸勘探」为 3 级，日板按"同星系取级别最高"进池（本卡会被顶掉）
    name: '深渊之门卫队',
    // C 族第二批（2026-09-11 船长「虫群编成」+ 族级结构修正）：编成改 **星髓幼虫 ×6 / 2 波（3+3）**。
    // 舰级由 T2「深渊之门卫队」换成 **星髓幼虫**（T1 护卫舰 544 m/s——船长「护卫舰级应该有 2 种，
    // 星髓幼虫和畸变幼虫」），故本卡条目**覆写**舰级缺省：血型**护盾**（卡面 shield）·
    // 命中 **0.90**（掷命中）· **纯等离子**（C 族唯一纯能量卡）· 射程 **1~2600**。
    // **总盘守恒**：总血 **1,000**（原 2 单位 625 + 375）÷ 6 = 每只 **166.667**；
    // 总单发 **112**（56 + 56）÷ 6 = 18.667 ⇒ 取整 **19**（Σ 114，**+1.79%**，四张卡唯一取舍，见设计稿 §十）。
    // N = 6 ⇒ 补偿 `12/7`，卡上 `dmgMul` 把它除掉。
    ships: [
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_hpMul_input1") * FOE_ALIEN_STARCORE.hp), // = 166.667/208（总血 1,000 的六分之一）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_dmgMul_input1"))), // 每只单发 19
        split: foeLayerSplit('shield'), // 血型随卡走（舰级缺省是装甲）
        hitRate: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_hitRate"), // 掷命中（原光束必中；本卡的单卡特征，不升格为舰级）
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_dmgMix_plasma") }, // 纯等离子（C 族唯一纯能量卡）
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_0_rangeMaxM"), // 卡带（舰级缺省 2655）
      },
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_hpMul_input1") * FOE_ALIEN_STARCORE.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_dmgMul_input1"))),
        split: foeLayerSplit('shield'),
        hitRate: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_hitRate"),
        dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_dmgMix_plasma") },
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "ships_1_rangeMaxM"),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "waves_1_hpShare") },
    ],
    galaxyId: 'galaxy-abyss',
    threat: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "threat"),
    /* ⟪2026-10-02 判据回钉⟫（船长令「两个都同意」之乙）：09-25 重定标改了标签时翻了近防炮门槛 ⇒ PD/修理判据回钉到**重定标前**旧标签 */
    threatJudged: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "threatJudged"), // 判据威胁（PD 门槛 ≥60 / 敌修理 k 读它；见 AnomalyDef.threatJudged）
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'brawl', // 船长裁定①：**kite → brawl**（射程同时收进近战带）
    defProfile: 'shield',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "dmgMix_plasma") }, // **纯能量**（C 族唯一纯能量卡；收束旋钮 = 命中 0.90 + 远端命中衰减 0.5）
    standingReq: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-abyss-guard", "combatSeconds"),
    description: '深渊之门常年有人值守，也常年需要民间火力分担防务。协会常驻悬赏：按次结算，声望仅首胜授予。',
  }

export const ANOMALY_ENTRY_12: AnomalyDef =
  {
    id: 'ano-starcore-boss',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '星髓虫群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "lairLevel"), // 窝点地图级别（3 = 全档）：C 族次强（星髓迷宫）
    name: '星髓虫群', // 2026-09-10 船长：与 C 族窝点档位词（虫巢/隐秘孵化地）冲突，改名（id 不变）
    // C 族第二批（2026-09-11 船长「虫群编成」+ 族级结构修正）：编成改
    // **星髓幼虫 ×7（波 1 ×4、波 2 ×3）+ 星髓成虫 ×3（第 3 波）**，共 10 只 / 3 波。
    // 船长：「**星髓幼虫给第一张和第三张卡**」+「**星髓成虫给第三张卡最后一波，血量占比要调整**」。
    // **血量占比调整（本卡唯一的算法取巧）**：成虫:幼虫 = **3:1**，正是两条舰级的档基线比（624:208）
    // ⇒ 全卡**共用一个血量倍率** `1530 ÷ (7×208 + 3×624) = 1530/3328`，
    // 于是每只幼虫 **95.625**、每只成虫 **286.875**（Σ = 669.375 + 860.625 = **1,530** 精确守恒），
    // 波次占比随之 = **25% / 18.75% / 56.25%**（末波是重头）。
    // **总单发守恒**：原 231（105 + 63×2）÷ 10 = 23.1 ⇒ 取整 **23**（Σ 230，**−0.43%**，见设计稿 §十）。
    // 形态 = **能量·掷命中**（C 族不保留光束必中：掷命中 0.95 + 命中随距离衰减 + 吃回避）；
    // 主系等离子 8:2；射程 1~2655（走舰级缺省）。N = 10 ⇒ 补偿 `20/11`。
    ships: [
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_wave"),
        hpMul:
          enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_hpMul_input1") * FOE_ALIEN_STARCORE.hp + enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_hpMul_input2") * FOE_ALIEN_STARCORE_ADULT.hp), // 幼虫 95.625
        dmgMul: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_0_dmgMul_input1"))), // 每只单发 23
      },
      {
        ship: FOE_ALIEN_STARCORE,
        count: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_wave"),
        hpMul:
          enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_hpMul_input1") * FOE_ALIEN_STARCORE.hp + enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_hpMul_input2") * FOE_ALIEN_STARCORE_ADULT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_dmgMul_input0") / (FOE_ALIEN_STARCORE.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_1_dmgMul_input1"))),
      },
      {
        ship: FOE_ALIEN_STARCORE_ADULT, // 末波：成虫 ×3（单个血量 = 幼虫 ×3）
        count: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_wave"),
        hpMul:
          enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_hpMul_input1") * FOE_ALIEN_STARCORE.hp + enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_hpMul_input2") * FOE_ALIEN_STARCORE_ADULT.hp), // 成虫 286.875
        dmgMul: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_dmgMul_input0") / (FOE_ALIEN_STARCORE_ADULT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-starcore-boss", "ships_2_dmgMul_input1"))),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_0_hpShare") }, // 幼虫 ×4 = 382.5
      { units: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_1_hpShare") }, // 幼虫 ×3 = 286.875
      { units: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_2_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "waves_2_hpShare") }, // 成虫 ×3 = 860.625（末波重头）
    ],
    galaxyId: 'galaxy-starcore',
    threat: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, 'ano-starcore-boss', 'threatJudged'),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'brawl',
    defProfile: 'armor',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "dmgMix_plasma"), explosive: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "dmgMix_explosive") }, // 混伤 8:2（2026-09-10 船长：主系 80% + 副系 20%，副系按族签名）
    standingReq: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-starcore-boss", "combatSeconds"),
    description: '星髓迷宫深处有东西在筑巢。协会将它列入最高级长期悬赏：进去的人要自己数着命回来。',
  }

export const ANOMALY_ENTRY_16: AnomalyDef =
  {
    id: 'ano-maw-hunt',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '噬口猎食群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "lairLevel"), // 窝点地图级别（3 = 全档）：C 族最强（星噬之口，威胁 87、奖金 85 万）
    name: '噬口猎杀令',
    // C 族第二批（2026-09-11 船长「虫群编成 + 稀有头目」）：编成改
    // **畸变幼虫 ×10（波 1 ×4、波 2 ×3、波 3 ×3）+ 噬口巨兽 ×1（第 3 波，精锐）**，共 11 单位 / 3 波。
    // 船长：「**只有噬口有头目出现**」「出现稀少…**因此也更加强大**」「**首领血量占比提高到 80%**」
    // +「**畸变幼虫给第二张和第四张**」+「巨兽提速降为 1.35，**给巨兽开启之前做过的冲锋能力**」
    // +「巨兽射程增加但是**不动目标距离**」。
    // **⚠ 2026-09-25 船长令「将巨兽的占比下调到 65%」** ⇒ 首领占比 80% → **65%**（火力同比例），
    //   小兵合计 35% 逐只均分 ⇒ 每只小虫 **3.5%**（原 2%）；**总量守恒不变**（65% + 3.5%×10 = 100%）。
    // **总盘守恒**（口径⑤）：总血 **2,766** = 首领 **1,797.9**（65%）+ 每只小虫 **96.81**（3.5%）×10；
    //   总单发 **501** = 首领 **325.7** + 每只小虫 **17.5** ×10（引擎逐项取整后见下方用例的实测值）。
    //   ⚠ 守恒基准是**现树实际值**（922 × 3 单位），不是卡面名义值 1,844——本卡是 C 族唯一多波卡，
    //   旧路径"波血 = 卡总血 × hpShare、波内无僚机时每单位拿满波血" ⇒ 实际 = 1844 × 0.5 × 3
    //   （见 `MAW_TOTAL_HP` 注释）。船长 2026-09-11 确认取 **2,766**，兑现"先落虫群、血量随后"。
    //   ⚠ 上列"总血/总单发"是**基准值**（重定价前的口径）；本卡 2026-09-25 起还吃
    //   `RERATE_20260925`（k = 1.444）⇒ 实际总血 3,994.104、总单发 720。
    // **目标距离不动**（2026-09-11 首定）：
    //   期望交距与开战距离都只读**波 0 编制的首个单位**（`foeDesiredRange` / `battleOpenM`），
    //   故小虫**排在最前**并覆写射程带为 **1~2713** ⇒ 两个距离逐字不变
    //   （期望交距 = 1 + 0.20×(2713−1) = **543 m**）。
    //   ⚠ 沿革：2026-09-14 曾「全族 +1000 射程」并改用 `desireRangeM: 543` 显式钉住 →
    //   **同日船长又令回滚**（「可以回滚C族敌人射程增加的修改」）⇒ 带与覆写都回到原值、钉子撤回
    //   （推导值仍是 543，故目标距离一个字没变）。
    // **冲锋**（2026-09-14 船长改判：逐单位 · 自身炮台命中即解除 · 冷却 10 秒）：
    //   巨兽 ×**3**、小虫（畸变幼虫）各 ×**1.5**，**各自独立**在冲（编队级单标志已作废）；
    //   详见 `docs/design/foe-charge-20260914.md` 与 `combat.updateFoeCharge`。
    // N = 11 ⇒ 补偿 `22/12`，卡上 `dmgMul` 把它除掉。
    ships: [
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_MINION_SHARE) / FOE_ALIEN_RIFT.hp, // 每只小虫 96.81（3.5%）
        dmgMul:
          (MAW_TOTAL_DMG * MAW_MINION_SHARE) /
          (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_dmgMul_input0"))), // 每只 17.5
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_0_rangeMaxM"), // 卡带（锚定期望交距 543 m 与开战距离；舰级缺省 2552）
      },
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_MINION_SHARE) / FOE_ALIEN_RIFT.hp,
        dmgMul:
          (MAW_TOTAL_DMG * MAW_MINION_SHARE) /
          (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_dmgMul_input0"))),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_1_rangeMaxM"),
      },
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_MINION_SHARE) / FOE_ALIEN_RIFT.hp,
        dmgMul:
          (MAW_TOTAL_DMG * MAW_MINION_SHARE) /
          (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_dmgMul_input0"))),
        rangeMaxM: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_2_rangeMaxM"),
      },
      {
        ship: FOE_ALIEN_MAW, // 稀有头目（**全族唯一** · 显示名「精锐噬口巨兽」）
        wave: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_3_wave"),
        hpMul: (MAW_TOTAL_HP * MAW_BOSS_SHARE) / FOE_ALIEN_MAW.hp, // 首领血 1,797.9（65%）
        dmgMul:
          (MAW_TOTAL_DMG * MAW_BOSS_SHARE) /
          (FOE_ALIEN_MAW.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-maw-hunt", "ships_3_dmgMul_input0"))), // 首领单发 325.7
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_0_hpShare") }, // 小虫 ×4 = 221.28
      { units: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_1_hpShare") }, // 小虫 ×3 = 165.96
      { units: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_2_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "waves_2_hpShare") }, // 头目 + 小虫 ×3 = 2,378.76
    ], // 多波次（2026-09-09 船长拍板首批：低安顶段 90~150s 无喘息；docs/design/wave-battles-20260909.md）
    // ⚠ 舰级路径下**血量不由 `hpShare` 决定**（走 `slot.hpMul` 的绝对值），本表在本卡只负责**排波次**；
    //   `units` 与编成条目一一对应（4 + 3 + 3 + 1）仅作可读性，改它不会改血量。
    //   **小虫必须排在巨兽之前**：`foes[0]`（波 0 首个主体单位）= 期望交距 / 开战距离的来源。
    galaxyId: 'galaxy-maw',
    threat: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "threat"),
    threatJudged: enemyParameterOf(bountiesParameters, 'ano-maw-hunt', 'threatJudged'),
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'brawl', // 2026-09-10 船长（族系改判）：**orbit（原缺省）→ brawl**（C 族＝螯颚/酸液喷吐的贴脸生物）
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "dmgMix_plasma"), explosive: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "dmgMix_explosive") }, // 主系**等离子**（原动能主）
    standingReq: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-maw-hunt", "combatSeconds"),
    description: '星噬之口吞噬过太多舰队。协会悬赏一切能削弱其守军的行动——常设令，可反复接取。',
  }

export const ANOMALY_ENTRY_24: AnomalyDef =
  {
    id: 'ano-chasm-aberrations',
    foeFamily: 'C', // 敌族（与美术层 FOE_ART 族字母同源）
    lairCore: '裂谷畸变群', // 赏金任务·窝点名的核心词（有值 = 可作为窝点目标）
    lairLevel: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "lairLevel"), // 窝点地图级别（2 = 到核心档）：裂谷深带
    name: '裂谷畸变体猎杀令',
    // C 族第二批（2026-09-11 船长「虫群编成」+ 族级结构修正）：编成改 **畸变幼虫 ×8 / 2 波（4+4）**。
    // 舰级由 T3「裂谷畸变体」换成 **畸变幼虫**（T1 护卫舰 544 m/s；船长「护卫舰级应该有 2 种，
    // 星髓幼虫和畸变幼虫」+「畸变幼虫给第二张和第四张」）。本卡**无任何覆写**——
    // 舰级缺省即卡面口径（均衡型 / 命中 0.95 / 等离子 8:2 / 射程 1~2552）。
    // **总盘守恒**：总血 **1,815**（原 1134.375 + 680.625）÷ 8 = 每只 **226.875**；
    // 总单发 **121**（76 + 45）÷ 8 = 15.125 ⇒ 取整 **15**（Σ 120，**−0.83%**，见设计稿 §十）。
    // N = 8 ⇒ 补偿 `16/9`，卡上 `dmgMul` 把它除掉。
    ships: [
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_hpMul_input1") * FOE_ALIEN_RIFT.hp), // = 226.875/260（总血 1,815 的八分之一）
        dmgMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_dmgMul_input0") / (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_0_dmgMul_input1"))), // 每只单发 15
      },
      {
        ship: FOE_ALIEN_RIFT,
        count: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_count"),
        wave: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_wave"),
        hpMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_hpMul_input0") / (enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_hpMul_input1") * FOE_ALIEN_RIFT.hp),
        dmgMul: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_dmgMul_input0") / (FOE_ALIEN_RIFT.shotDmg * COMP_MUL(enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "ships_1_dmgMul_input1"))),
      },
    ],
    waves: [
      { units: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_0_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_0_hpShare") },
      { units: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_1_units"), hpShare: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "waves_1_hpShare") },
    ],
    galaxyId: 'galaxy-chasm',
    threat: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "threat"),
    /* ⟪2026-10-02 判据回钉⟫（船长令「两个都同意」之乙）：09-25 重定标改了标签时翻了近防炮门槛 ⇒ PD/修理判据回钉到**重定标前**旧标签 */
    threatJudged: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "threatJudged"), // 判据威胁（PD 门槛 ≥60 / 敌修理 k 读它；见 AnomalyDef.threatJudged）
    wreckThreat: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "wreckThreat"), // 回收口径（冻结值，见本表头注）
    tactic: 'brawl',
    defProfile: 'balanced',
    dmgMix: { plasma: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "dmgMix_plasma"), explosive: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "dmgMix_explosive") }, // 主系**等离子**（原动能主；副系 = C 族签名 爆炸）
    standingReq: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "standingReq"),
    standingGain: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "standingGain"),
    rewardIsk: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "rewardIsk"),
    loot: [],
    combatSeconds: enemyParameterOf(bountiesParameters, "ano-chasm-aberrations", "combatSeconds"),
    description: '裂谷深带的引力畸变催生出集群异形，威胁深层矿道。协会将其列为长期高危猎杀令。',
  }
