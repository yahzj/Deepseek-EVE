/** 功能域职责拆分，保持原计算与顺序。 */
import { type ModuleDef, type ModuleSlot, type DamageType, rackOf, beamPowerFactor, MY_WEB_RANGE_M, WEB_BREAK_DIST_M, FOE_RANGE_DEBUFF_FLOOR_M, SHIELD_PULSE_MS, SHIELD_FIELD_COST_PCT, stackingOf, DC_LOCK_MS, droneReviveCycleMsOf, equipmentCycleMsOf } from '@whale/core'
import { type InfoLine, pct, resistAddLine, repairAmountText, repairKitName, fmt, reviveCycleSecs, DMG_LABEL, pctOpt, propTailOf, DmgChip, rangeText, salvageCycleSecs, fittedRepairLine, recoveryPct, fittedDecayLine } from './primitives'
import { tr } from '../../../i18n/locale'
import type { GameEngine } from '../../../game/engine'
import { moduleSubKeyOf, MODULE_SUBS, subText } from '../../../ui/itemSubs'
import { slotText, rackText } from '../../../ui/labelsText'
import { moduleShortEffect } from './moduleEffects'

/**
 * 跨族加成（2026-09-11 船长反馈修复：「赃物强化舱的属性并没有显示装甲容量的加成数值」）：
 *
 * 起因：模块信息行 / 短效文案原先都按 `mod.slot` 走分支渲染（装甲槽只画装甲、货舱槽只画货舱……），
 * 于是**槽位族之外的加成会被整段吞掉**——赃物强化舱是**货舱槽**却带 `armorHpBonus 0.15`（货舱 +100%
 * 的"搭车"装甲板），界面上就只剩货舱那一行。同类还有：生体甲壳板（装甲槽带自愈）在**信息卡**里看不到自愈、
 * 生体损管腔（支援槽带结构抗性，此前后者靠尾段补上）。
 *
 * 修法：不改各槽位分支的既有渲染，而是在**尾部**补一段「跨族加成」——凡"字段归属槽位 ≠ 本件槽位"
 * 的有效字段一律补齐（归属槽位自己的分支已经画过的不重复）。日后新增"槽位族之外的搭车加成"自动可见。
 */
export function crossFamilyLines(mod: ModuleDef): InfoLine[] {
  const out: InfoLine[] = []
  const foreign = (owner: ModuleSlot): boolean => mod.slot !== owner
  // 装甲族（容量 / 抗性 / 机动代价）
  if (foreign('armor')) {
    if (mod.armorHpBonus !== undefined) out.push({ k: tr("ui.shipInfo.016"), v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.004"), mod.armorResistAdd)
    if (row) out.push(row)
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      out.push({
        k: tr("ui.shipInfo.017"),
        v: (
          <>
            <em className="app-chip is-cost">{tr("ui.shipInfo.134", { p1: (1 - pen).toFixed(2) })}</em>
            <span className="app-dim">{tr("ui.shipInfo.018")}</span>
          </>
        ),
      })
    }
  }
  // 护盾族（容量 / 抗性）
  if (foreign('shield')) {
    if (mod.shieldHpBonus !== undefined) out.push({ k: tr("ui.shipInfo.019"), v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.002"), mod.shieldResistAdd)
    if (row) out.push(row)
  }
  // ⟪文案调整 2026-10-08⟫ 跨族速度已由通用航速行显示，不把装甲/支援件再标成加力推进。
  if (foreign('propulsion')) {
    if ((mod.hitPenalty ?? 0) > 0) {
      out.push({ k: tr("ui.shipInfo.021"), v: tr("ui.shipInfo.136", { p1: (1 - (mod.hitPenalty ?? 0)).toFixed(2) }) })
    }
  }
  // 维修/自愈（支援槽之外也带得动：生体甲壳板）
  if (foreign('support') && ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0)) {
    const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
    const isFree = mod.repairFree === true
    out.push({
      k: isFree ? tr("ui.shipInfo.022") : tr("ui.shipInfo.023"),
      v: tr("ui.shipInfo.137", { secs: secs, p2: repairAmountText(mod) }),
    })
    out.push({
      k: tr("ui.shipInfo.024"),
      v: isFree ? (
        <>
          <em className="app-chip is-ok">{tr("ui.shipInfo.025")}</em>
          <span className="app-dim">{tr("ui.shipInfo.026")}</span>
        </>
      ) : (
        <>
          <em className="app-chip is-cost">{repairKitName(mod)} {tr("ui.shipInfo.138")}</em>
          <span className="app-dim">{tr("ui.shipInfo.027")}</span>
        </>
      ),
    })
  }
  // 无人机三族（甲板扩展 / 战术导控 / 中继天线）
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.028"), v: `+${fmt(mod.droneBayBonusM3 ?? 0)} m³` })
  }
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.029"), v: `+${pct(mod.droneDmgBonus ?? 0)}` })
  }
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.030"), v: tr("ui.shipInfo.139", { p1: pct(mod.droneRangeBonusPct ?? 0) }) })
  }
  // 无人机储备甲板（2026-09-27 船长令）：第四族 —— 与上面三族同一支"外族件"清单
  // ⚠ 行值用**裸秒数**（`.207`）：行名已经写了"复位周期"，值里再写一遍就成了「复位周期：复位周期 15 秒」
  //   （同族 `drone-rack` 也是"行值裸值、短行带名"）。
  if (foreign('drone-deck') && (mod.droneReviveCycleMs ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.206"), v: tr("ui.shipInfo.207", { p1: reviveCycleSecs(mod) }) })
  }
  // 2026-09-27 无人机护盾投射仪（中槽）：只加放飞无人机的护盾层
  // ⚠ 合并：id 撞号 ⇒ 顺移到 `.208`。
  if (foreign('drone-shield') && (mod.droneShieldHpBonusPct ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.208"), v: `+${pct(mod.droneShieldHpBonusPct ?? 0)}` })
  }
  // 支援件四族（炮台伤害 / 射速 / 命中 / 回避）
  if (foreign('support')) {
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      out.push({
        k: tr("ui.shipInfo.031"),
        v: `${Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => `${DMG_LABEL[t as DamageType]} +${pct(v ?? 0)}`)
          .join(' · ')}`,
      })
    }
    if (mod.reloadCutPct !== undefined) out.push({ k: tr("ui.shipInfo.032"), v: tr("ui.shipInfo.140", { p1: pct(mod.reloadCutPct) }) })
    if (mod.hitBonusPct !== undefined) out.push({ k: tr("ui.shipInfo.033"), v: tr("ui.shipInfo.141", { p1: (1 + mod.hitBonusPct).toFixed(2) }) })
    if (mod.evasionGapPct !== undefined) out.push({ k: tr("ui.shipInfo.034"), v: tr("ui.shipInfo.142", { p1: (1 - mod.evasionGapPct).toFixed(2) }) })
  }
  // 目标锁定阵列（2026-09-17 船长：增伤与集火都「全队生效」）
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) {
    out.push({ k: tr("ui.shipInfo.035"), v: tr("ui.shipInfo.143", { p1: pct(mod.lockDmgBonus) }) })
  }
  // 协处理器（2026-09-11）：CPU 预算扩容——本职在 cpu 族；写在别的槽位上才算跨族（当前无此件，护栏登记着）
  if (foreign('cpu') && (mod.cpuBonus ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.144"), v: tr("ui.shipInfo.145", { p1: fmt(mod.cpuBonus ?? 0) }) })
  }
  return out
}

/**
 * 装备统一信息行（V17：各家族按"真实进公式的参数"渲染，取代旧统一百分比行）：
 * 工业槽 = 加成系数；炮台 = 武器卡（配弹/射程带/命中衰减/装填/伤害倍率）；
 * 护盾/装甲 = 容量 + 分系"缺口削减"抗性（合成：实际抗性 = 1 − (1−船体基础) × (1−缺口)，
 * 上限 90%——基础抗越高的船装同系模块收益越低）；推进器 = 加力推进（战斗速度）。
 *
 * ⚠ **可选 `engine` ＋ `shipId`**（**2026-09-29 船长令**）：给了就把"装上船之后"的实修值也渲染出来
 * （如修理件的「装到船上：各 19（10）点」）。不传 = 与改动前逐字一致（仓库/市场/手册那些"还没上船"的卡）。
 */
export function moduleInfoLines(mod: ModuleDef, engine?: GameEngine, shipId?: string, ordinal = 1): InfoLine[] {
  /**
   * 「槽位 / 类型」那一行的**类型**：默认 = 槽位名（`SLOT_LABELS`）。
   *
   * ⚠ **2026-09-26 船长令**：「**装备的'槽位 / 类型'这个也要更新**」——支援件在装备细分类里拆成
   * 三个同级（战斗支援件 / 辅助支援件 / 修理装置），信息卡这一行也必须跟着细：
   * 原先 34 件**共用一个 `support` 槽位名**（「支援系统」），玩家在卡上看不出它属于哪一档。
   * ⇒ 支援件优先取**功能子类名**（`moduleSubKeyOf(slot, id)` → `MODULE_SUBS` 的 `subText`）；
   * 其余族**行为一字不变**（它们的槽位名与功能子类名本就同名，不引入无谓改动）。
   */
  const subKey = moduleSubKeyOf(mod.slot, mod.id)
  const subOpt = MODULE_SUBS.find((s) => s.key === subKey)
  const typeText = mod.slot === 'support' && subOpt ? subText(subOpt) : slotText(mod.slot)
  const lines: InfoLine[] = [{ k: tr("ui.shipInfo.036"), v: `${typeText}（${rackText(rackOf(mod))}）` }]
  if (mod.slot === 'miner') {
    lines.push({ k: tr("ui.shipInfo.037"), v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'cargo') {
    lines.push({ k: tr("ui.Handbook.010"), v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'drone-shield') {
    lines.push({ k: tr('ui.shipInfo.208'), v: `+${pctOpt(mod.droneShieldHpBonusPct)}` })
  } else if (mod.slot === 'shield') {
    if (mod.shieldHpBonus !== undefined) lines.push({ k: tr("ui.shipInfo.019"), v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.002"), mod.shieldResistAdd)
    if (row) lines.push(row)
  } else if (mod.slot === 'armor') {
    if (mod.armorHpBonus !== undefined) lines.push({ k: tr("ui.shipInfo.016"), v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.004"), mod.armorResistAdd)
    if (row) lines.push(row)
    // 重甲件的机动代价（2026-09-10 船长：陵寝装甲层 −25%）——多件不叠加、取最重一件
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      lines.push({
        k: tr("ui.shipInfo.017"),
        v: (
          <>
            <em className="app-chip is-cost">{tr("ui.shipInfo.134", { p1: (1 - pen).toFixed(2) })}</em>
            <span className="app-dim">{tr("ui.shipInfo.018")}</span>
          </>
        ),
      })
    }
  } else if (mod.slot === 'propulsion') {
    if (mod.speedBonusPct !== undefined) {
      // 2026-09-10 船长定：推进器改周期点火（点火 60 秒 → 冷却 60 秒，开场即点火）
      // 2026-09-11 船长定精简：去掉"冷却期间无加速"（同义重复）与"说明"行
      lines.push({
        k: tr("ui.shipInfo.020"),
        v: (
          <>
            {tr("ui.shipInfo.135", { p1: pct(mod.speedBonusPct) })}
            <span className="app-dim">{propTailOf(mod)}</span>
          </>
        ),
      })
    }
    if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) {
      lines.push({ k: tr("ui.shipInfo.021"), v: tr("ui.shipInfo.136", { p1: (1 - mod.hitPenalty).toFixed(2) }) })
    }
  } else if (mod.slot === 'turret') {
    if (mod.damageType !== undefined) {
      lines.push({
        k: tr("ui.BattleScreen.003"),
        v: (
          <>
            <span className="app-dim">{tr("ui.shipInfo.038")}</span>
            <DmgChip t={mod.damageType} label={tr("ui.FitPage.127", { p1: DMG_LABEL[mod.damageType] })} />
            <span className="app-dim">{tr("ui.shipInfo.039")}</span>
          </>
        ),
      })
    } else if (mod.ammoPerEngagement !== undefined) {
      lines.push({ k: tr("ui.BattleScreen.003"), v: tr("ui.shipInfo.149", { p1: mod.ammoPerEngagement }) })
    }
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    // **防空（属性）**（船长 2026-09-12：「**给近防炮系列添加一个属性"防空"，将近防炮的对无人机伤害 ×2
    // 写到防空属性里**」）：一条属性 = ①能筛到敌方机群 ②对无人机伤害 ×该值 ⇒ 渲染为一行「防空」。
    if (mod.antiDrone !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.041"),
        v: (
          <>
            {tr('ui.shipInfo.180')}
            <span className="app-dim">{`　对无人机伤害 ×${mod.antiDrone}`}</span>
          </>
        ),
      })
    }
    if (mod.hitRate !== undefined || mod.falloff !== undefined) {
      const hit = mod.hitRate !== undefined ? tr("ui.shipInfo.150", { p1: pct(mod.hitRate) }) : ''
      const ff = mod.falloff !== undefined ? tr("ui.shipInfo.151", { p1: mod.falloff }) : ''
      lines.push({ k: tr("ui.shipInfo.042"), v: [hit, ff].filter(Boolean).join('　') })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.153", { p1: String(mod.dmgMult) + ((mod.shots ?? 1) > 1 ? `×${mod.shots}` : ``) }) })
  } else if (mod.slot === 'missile') {
    // V18B-1 导弹架：武器卡（与炮台同参数字段，性格差异 = 无视近盲 + 追踪命中）
    lines.push({
      k: tr("ui.shipInfo.045"),
      v: (
        <>
          <span className="app-dim">{tr("ui.shipInfo.038")}</span>
          <DmgChip t={mod.damageType ?? 'explosive'} label={tr("ui.FitPage.008")} />
          <span className="app-dim">{tr("ui.shipInfo.039")}</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: tr("ui.shipInfo.046"), v: tr("ui.shipInfo.047") })
    if (mod.hitRate !== undefined) lines.push({ k: tr("ui.shipInfo.048"), v: `${pct(mod.hitRate)}` })
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.154", { p1: String(mod.dmgMult) + ((mod.shots ?? 1) > 1 ? `×${mod.shots}` : ``) }) })
  } else if (mod.slot === 'laser') {
    // V18B-2 激光炮：能量系武器形态（必中光束 + 威力随距离衰减）
    lines.push({
      k: tr("ui.shipInfo.049"),
      v: (
        <>
          <span className="app-dim">{tr("ui.shipInfo.050")}</span>
          <DmgChip t={mod.damageType ?? 'plasma'} label={tr("ui.FitPage.009")} />
          <span className="app-dim">{tr("ui.shipInfo.051")}</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: tr("ui.shipInfo.052"), v: tr("ui.shipInfo.053") })
    if (mod.falloff !== undefined) {
      // 2026-09-11 修：此行原来自算 (1+falloff)/2（×0.65/×0.68），而引擎 `beamPowerFactor` 在旧口径下
      // 实际是最远端 ×0.44/×0.48 —— 面板读数与实战不符。改为**直接问引擎要最远端系数**，
      // 日后衰减口径再调整（如统一"最远端 = falloff"）面板自动跟随，不会再漂移。
      const far = beamPowerFactor(mod.maxRangeM ?? 0, {
        minRangeM: mod.minRangeM ?? 0,
        maxRangeM: mod.maxRangeM ?? 0,
        falloff: mod.falloff,
      })
      lines.push({
        k: tr("ui.shipInfo.054"),
        v: tr("ui.shipInfo.155", { p1: far.toFixed(2) }),
      })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.156", { p1: String(mod.dmgMult) + ((mod.shots ?? 1) > 1 ? `×${mod.shots}` : ``) }) })
  } else if (mod.slot === 'drone-rack') {
    if (mod.droneBayBonusM3 !== undefined) {
      lines.push({ k: tr("ui.shipInfo.028"), v: `+${fmt(mod.droneBayBonusM3)} m³` })
    }
  } else if (mod.slot === 'drone-tac') {
    if (mod.droneDmgBonus !== undefined) {
      lines.push({ k: tr("ui.shipInfo.029"), v: `+${pct(mod.droneDmgBonus)}` })
    }
    /**
     * **对方对机群的命中收窄**（**2026-09-29 船长令**：巨构导控塔「对方对无人机的命中收窄 5%」）：
     * 行名 + 值两条（`.211`/`.212`），与 `.210`「机群结构层」同一套"行名不带占位符"的写法。
     * 值栏写成 `−5%`（方向 = 变差的是**对方**的命中）。
     */
    if ((mod.droneHitGapPct ?? 0) > 0) {
      lines.push({ k: tr("ui.shipInfo.211"), v: tr("ui.shipInfo.212", { p1: pct(mod.droneHitGapPct ?? 0) }) })
    }
  } else if (mod.slot === 'drone-relay') {
    if (mod.droneRangeBonusPct !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.030"),
        v: tr("ui.shipInfo.139", { p1: pct(mod.droneRangeBonusPct) }),
      })
    }
  } else if (mod.slot === 'drone-deck') {
    /**
     * 无人机储备甲板（2026-09-27 船长令）：装备卡/详情表的**参数行** —— 复位周期。
     * ⚠ 与短行同一个单点 `reviveCycleSecs` ⇒ 两处永远同数。
     * ⚠ 行名用 `.206`（`.031` 已被支援件的伤害行占用）。
     */
    if (mod.droneReviveCycleMs !== undefined) {
      lines.push({ k: tr("ui.shipInfo.206"), v: tr("ui.shipInfo.207", { p1: reviveCycleSecs(mod) }) })
    }
  } else if (mod.slot === 'salvager') {
    // 2026-09-11 船长定精简时补：打捞器此前只显示"叠加方式 + CPU"，看不到真正的效果
    if (mod.salvageCycleMs !== undefined) {
      lines.push({ k: tr("ui.shipInfo.055"), v: tr("ui.shipInfo.110", { p1: salvageCycleSecs(mod) }) }) // 与短行同单点
    }
  } else if (mod.slot === 'support') {
    // V18.1 支援件：按效果字段渲染（低槽 = 稳定器/射速计算机；中槽 = 索敌/陀螺）
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      lines.push({
        k: tr("ui.shipInfo.031"),
        v: (
          <>
            {Object.entries(dmg)
              .filter(([, v]) => (v ?? 0) > 0)
              .map(([t, v]) => (
                <span key={t} className="app-stack-inline">
                  <DmgChip t={t as DamageType} />
                  <span className="app-dim">{` +${pct(v ?? 0)}`}</span>
                </span>
              ))}
          </>
        ),
      })
    }
    if (mod.reloadCutPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.032"), v: tr("ui.shipInfo.140", { p1: pct(mod.reloadCutPct) }) })
    }
    if (mod.hitBonusPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.033"), v: tr("ui.shipInfo.141", { p1: (1 + (mod.hitBonusPct ?? 0)).toFixed(2) }) })
    }
    if (mod.evasionGapPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.034"), v: tr("ui.shipInfo.142", { p1: (1 - (mod.evasionGapPct ?? 0)).toFixed(2) }) })
    }
    if (mod.blink) {
      lines.push({ k: tr('ui.moduleSpecs.005'), v: tr('ui.moduleSpecs.006', { p1: mod.blink.distanceM, p2: mod.blink.cooldownMs / 1000 }) })
    }
    // 隐秘行动装置（2026-09-15 船长：高槽 · 自身武器开火前隐身 20/30 秒 · 不被锁定不被攻击）
    if (mod.stealthMs !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.056"),
        v: tr("ui.shipInfo.157", { p1: mod.stealthMs / 1000 }),
      })
      lines.push({ k: tr("ui.shipInfo.057"), v: tr("ui.shipInfo.058") })
    }
    /**
     * **墨潮捕获网的三项关键属性进参数行**（**2026-09-29 船长令**：「将一些关键属性（比如射程，
     * 减速幅度）放进属性里」）——
     * 投网射程 / 断开距离（米）各一行、减速幅度单列一行（`−50%（机动 ×0.5）`）。
     * 数值全部**取件上字段**（缺省回落引擎常量），说明里不再重复这些数字。
     * 周期（秒）已在短行里报过，这里不重复。
     *
     * ⚠ **投网射程那一格带尾注「（不受其它射程效果影响）」**（**2026-09-29 船长令**：
     * 「网子需要备注不受其他射程效果影响」）：卡面别处会出现"射程插件 +20%"这类**武器**射程加成，
     * 不注一句玩家就会以为网子也吃。走 `app-dim` 短注（与 `ui.shipInfo.018/026` 同款），
     * **不另开一行长说明**（船长 2026-09-29 刚因此砍掉过一条"修复量 ｜ 实际每跳 = …"）。
     * 口径出处：插件/技能/科技/敌方压制的增程都只进**武器有效射程**（`combat` 的 `rangeBonus`），
     * 网的射程只认 `captureWebRangeM`。
     */
    if (mod.captureWebCycleMs !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.238"),
        v: (
          <>
            {tr("ui.shipInfo.241", { p1: fmt(mod.captureWebRangeM ?? MY_WEB_RANGE_M) })}
            <span className="app-dim">{tr("ui.shipInfo.244")}</span>
          </>
        ),
      })
      lines.push({
        k: tr("ui.shipInfo.239"),
        v: `${tr("ui.shipInfo.241", { p1: fmt(mod.captureWebBreakM ?? WEB_BREAK_DIST_M) })}`,
      })
      const slowMul = mod.captureWebSlowMul ?? 0.5
      lines.push({
        k: tr("ui.shipInfo.240"),
        v: tr("ui.shipInfo.242", { p1: Math.round((1 - slowMul) * 100), p2: String(slowMul) }),
      })
    }
    // 船体维修装置 / 生体自愈件（2026-09-09 船长定自动修复；2026-09-10 增无消耗自愈）
    if ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0) {
      const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
      const isFree = mod.repairFree === true
      lines.push({
        k: isFree ? tr("ui.shipInfo.022") : tr("ui.shipInfo.023"),
        v: tr("ui.shipInfo.137", { secs: secs, p2: repairAmountText(mod) }),
      })
      if (isFree) {
        // 无消耗自愈（异形生体件）：不吃组件、永不停机；同型多件按 EVE 曲线递减
        lines.push({
          k: tr("ui.shipInfo.024"),
          v: (
            <>
              <em className="app-chip is-ok">{tr("ui.shipInfo.025")}</em>
              <span className="app-dim">{tr("ui.shipInfo.026")}</span>
            </>
          ),
        })
      } else {
        lines.push({
          k: tr("ui.shipInfo.024"),
          v: (
            <>
              <em className="app-chip is-cost">{repairKitName(mod)} {tr("ui.shipInfo.138")}</em>
              <span className="app-dim">{tr("ui.shipInfo.027")}</span>
            </>
          ),
        })
      }
      /**
       * **修复量的呈现（2026-09-29 船长令改判）**：
       * 原先这里固定再加一行长解释「修复量 ｜ 实际每跳 = 上表值 × 装甲/结构容量加成 × 恢复量技能（…）」
       * —— 船长点名**删掉**（"过于长的说明属性"）。改为：**装了船就把实修值直接算出来**（上一行 `.214`），
       * 没装船就只有上表的基础值（本行的第一段）。
       */
      if (shipId !== undefined && engine !== undefined) {
        const fitted = fittedRepairLine(engine, shipId, mod)
        if (fitted) lines.push(fitted)
      }
    }
  } else if (mod.slot === 'target-lock') {
    // 2026-09-09 目标锁定阵列（高槽 target-lock）：集火 + 目标受击加深
    // **2026-09-17 船长：增伤与集火都改「全队生效」**（编队取最高一份）
    lines.push({ k: tr("ui.shipInfo.061"), v: tr("ui.shipInfo.062") })
    if (mod.lockDmgBonus !== undefined) {
      lines.push({ k: tr("ui.shipInfo.035"), v: tr("ui.shipInfo.147", { p1: pct(mod.lockDmgBonus) }) })
    }
  } else if (mod.slot === 'cpu') {
    // 2026-09-11 协处理器（低槽）：装配 CPU 预算扩容；**本件自身不占 CPU**（船长定）——
    // 两行都写清：扩容多少 + 自己不占（否则玩家看到"CPU 占用 0"会以为是坏的）
    if (mod.cpuBonus !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.144"),
        v: (
          <>
            {tr("ui.shipInfo.158", { p1: fmt(mod.cpuBonus) })}
            <span className="app-dim">{tr("ui.shipInfo.063")}</span>
          </>
        ),
      })
    }
    lines.push({
      k: tr("ui.shipInfo.064"),
      v: (
        <>
          <em className="app-chip is-ok">{tr("ui.shipInfo.159")}</em>
          <span className="app-dim">{tr("ui.shipInfo.065")}</span>
        </>
      ),
    })
  }
  /**
   * 结构层：**容量**（E 族巨构骨架引出；任何槽位都可能带）与**抗性**（生体损管腔）两行分开——
   * 容量 = 那层血更厚、抗性 = 那层血更耐打。
   *
   * ⚠ **2026-09-27 船长报障后改**：原先容量那行的值后面还跟着一句灰色注
   * 「（最后一段血量）」（`ui.shipInfo.067`）——那是**解释**（"结构是第几层"），
   * 按 2026-09-17 立的硬规矩（说明/参数里只放规格，不写原因解释）不该出现在卡面；
   * 且行名「结构容量」对「结构抗性」本就分得开，不必再解释。该注已删、id 已从表里撤掉。
   */
  if ((mod.hullHpBonus ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.066"), v: `+${pct(mod.hullHpBonus ?? 0)}` })
  }
  const hullRow = resistAddLine(tr("ui.FitPage.005"), mod.hullResistAdd)
  if (hullRow) lines.push(hullRow)
  /* ── 2026-09-13 虫洞专属装备引出的新旋钮（船长逐条给定；**任何槽位都可能带**，故独立成段）──
   * 口径与引擎一致：附加伤害段/耗弹倍数/射程削减与按系加成/通用单发/装填惩罚/全层抗性削减/出击周期。
   * 缺省不写 ⇒ 既有装备一行都不多。 */
  if ((mod.secondaryDamagePct ?? 0) > 0) {
    lines.push({
      k: tr("ui.shipInfo.068"),
      v: tr("ui.shipInfo.160", { p1: pct(mod.secondaryDamagePct ?? 0), p2: DMG_LABEL[(mod.secondaryDamageType ?? 'kinetic') as DamageType] }),
    })
  }
  if ((mod.ammoPerShot ?? 1) > 1) {
    lines.push({ k: tr("ui.shipInfo.069"), v: tr("ui.shipInfo.161", { p1: mod.ammoPerShot ?? 1 }) })
  }
  if ((mod.rangeCutPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.070"), v: tr("ui.shipInfo.162", { p1: pct(mod.rangeCutPct ?? 0) }) })
  }
  if (mod.rangeTypeBonusPct) {
    for (const [t, v] of Object.entries(mod.rangeTypeBonusPct)) {
      if ((v ?? 0) > 0) lines.push({ k: tr("ui.shipInfo.163", { p1: DMG_LABEL[t as DamageType] }), v: `+${pct(v ?? 0)}` })
    }
  }
  if ((mod.damageBonusPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.071"), v: tr("ui.shipInfo.164", { p1: pct(mod.damageBonusPct ?? 0) }) })
  }
  if ((mod.reloadPenaltyPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.072"), v: tr("ui.shipInfo.165", { p1: pct(mod.reloadPenaltyPct ?? 0) }) })
  }
  if ((mod.allResistPenaltyPct ?? 0) > 0) {
    lines.push({
      k: tr("ui.shipInfo.073"),
      v: tr("ui.shipInfo.166", { p1: fmt((mod.allResistPenaltyPct ?? 0) * 100) }),
    })
  }
  if ((mod.droneCycleCutPct ?? 0) > 0) {
    // ⟪文案调整 2026-10-08⟫
    lines.push({ k: tr("ui.shipInfo.074"), v: tr("ui.shipInfo.167", { p1: pct(mod.droneCycleCutPct ?? 0) }) })
  }
  if (mod.droneLaunchCutPct !== undefined) lines.push({ k: tr('ui.launchCalibration.004'), v: tr('ui.launchCalibration.001', { p1: Math.round(mod.droneLaunchCutPct * 100) }) })
  if (mod.laserFalloffBonus !== undefined) lines.push({ k: tr('ui.launchCalibration.005'), v: `+${mod.laserFalloffBonus}` })
  // ⟪文案调整 2026-10-09⟫ 酸蚀规格只显示装甲减抗。
  if (mod.acidOnHit) lines.push({ k: tr('ui.alienLoot.001'), v: tr('ui.alienLoot.002', { p1: mod.acidOnHit.cutPct * 100, p2: mod.acidOnHit.durationMs / 1000 }) })
  if (mod.speedRamp) lines.push({ k: tr('ui.alienLoot.003'), v: tr('ui.alienLoot.004', { p1: (mod.speedBonusPct ?? 0) * 100, p2: mod.speedRamp.maxBonusPct * 100, p3: mod.speedRamp.rampMs / 1000 }) })
  if ((mod.speedBonusPct ?? 0) > 0 && mod.slot !== 'propulsion' && !mod.speedRamp) {
    lines.push({ k: tr("ui.shipInfo.075"), v: tr("ui.shipInfo.168", { p1: pct(mod.speedBonusPct ?? 0) }) })
  }
  // 跨族加成（2026-09-11 修复：槽位族之外的加成原先一律不显示——见 crossFamilyLines 注释）
  lines.push(...crossFamilyLines(mod))
  // ⟪文案调整 2026-10-04⟫ 这些读数原来只在短行或正文，通用详情也应可见。
  if ((mod.foeRangeDebuffPct ?? 0) > 0) {
    lines.push({ k: tr('ui.moduleSpecs.001'), v: tr('ui.shipInfo.185', { p1: pct(mod.foeRangeDebuffPct ?? 0), p2: String(FOE_RANGE_DEBUFF_FLOOR_M) }) })
  }
  if ((mod.shieldPulsePct ?? 0) > 0) {
    lines.push({ k: tr('ui.moduleSpecs.002'), v: tr('ui.shipInfo.103', { p1: SHIELD_PULSE_MS / 1000, p2: recoveryPct(mod.shieldPulsePct ?? 0) }) })
  }
  if ((mod.shieldFieldPct ?? 0) > 0 && (mod.shieldFieldMs ?? 0) > 0) {
    // ⟪文案调整 2026-10-07⟫ 详情与装配短行共用同一机制模板及代价常量。
    lines.push({ k: tr('ui.moduleSpecs.003'), v: tr('ui.shipInfo.181', { p1: (mod.shieldFieldMs ?? 0) / 1000, p2: recoveryPct(mod.shieldFieldPct ?? 0), p3: recoveryPct(SHIELD_FIELD_COST_PCT) }) })
  }
  if (mod.overlayDrive) {
    lines.push({ k: tr('ui.moduleSpecs.004'), v: tr('ui.shipInfo.246', { p1: ((mod.reloadMs ?? 0) / 1000).toFixed(1), p2: (mod.overlayDrive.stepMs / 1000).toFixed(1), p3: (mod.overlayDrive.floorMs / 1000).toFixed(1) }) })
  }
  if (mod.rebirthRepair) lines.push({ k: tr('ui.gravekeeperGear.001'), v: tr('ui.gravekeeperGear.002', {
    p1: mod.rebirthRepair.repairMs / 1000, p2: mod.rebirthRepair.armorTotalPct * 100, p3: mod.rebirthRepair.hullTotalPct * 100,
  }) })
  if (mod.crisisOverload) {
    const d = mod.crisisOverload
    lines.push({ k: tr('ui.gravekeeperGear.003'), v: tr('ui.gravekeeperGear.004', { p1: d.rangeBonusPct * 100, p2: d.damageBonusPct * 100, p3: d.speedPenaltyPct * 100 }) })
    lines.push({ k: tr('ui.gravekeeperGear.005'), v: tr('ui.gravekeeperGear.006', { p1: (1 - d.droneInitialCutPct) * 100, p2: (1 - d.droneCycleCutPct) * 100 }) })
  }
  if (mod.railCharge) lines.push({ k: tr('ui.gravekeeperGear.007'), v: tr('ui.gravekeeperGear.008', {
    p1: mod.railCharge.damageStepPct * 100, p2: mod.railCharge.reloadStepPct * 100, p3: mod.railCharge.maxStacks,
  }) })
  if (mod.burst) {
    lines.push({ k: tr('ui.moduleSpecs.007'), v: tr('ui.moduleSpecs.008', { p1: mod.burst.shots, p2: mod.burst.gapMs / 1000 }) })
  }
  if (mod.slot === 'plug') lines.push({ k: tr('ui.moduleSpecs.009'), v: moduleShortEffect(mod) })
  // V18.1 叠加方式标签（所有装备统一：收敛件 = 多装递减；线性件 = 全额叠加；
  // 2026-09-15 隐秘行动装置 = **取最长一件、不叠加**——`max` 组单列一档，不谎报"全额叠加"）
  // 2026-09-11 船长定精简：只留结论一句（机制解释在手册「装配」条目里）
  const st = stackingOf(mod)
  // ⟪文案调整 2026-10-19⟫ 安装限制和独立运作不是加算收益，单独说明。
  if (mod.plugNonStacking) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.factionPlug.007') })
  } else if (mod.unique === true) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.252') })
  } else if (mod.slot === 'plug' && ((mod.midSlotsAdd ?? 0) > 0 || (mod.lowSlotsAdd ?? 0) > 0)) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.255') })
  } else if (mod.targetWeightMul !== undefined) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.254') })
  } else if (['turret', 'laser', 'missile', 'drone-deck'].includes(mod.slot)) {
    lines.push({ k: tr('ui.shipInfo.076'), v: tr('ui.shipInfo.253') })
  } else if (st.group === 'flat') {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr("ui.shipInfo.077") })
  } else if (st.group === 'max') {
    /**
     * `max`组分别标明最长隐身、最快捕获网或最优短距跃迁，不共用方向含混的标签。
     * - 隐秘行动装置 = **取最长一件**（最长隐身窗口说了算）；
     * - 捕获网（`kind: 'capture-web'`）= **取最快一台**（实现里 `webCycleMs` 用 `Math.min`，
     *   更快的那台说了算）——拿"取最长"去说"取最短"就是谎报方向。
     */
    lines.push({ k: tr("ui.shipInfo.076"), v: st.kind === 'capture-web' ? tr("ui.shipInfo.243") : st.kind === 'blink' ? tr("ui.shipInfo.251") : tr("ui.shipInfo.078") })
  } else if (st.group === 'fleetDecay') {
    /**
     * **全队多件递减（乘法叠加）**（**2026-09-29 船长令**：原话「这类全队型的效果，能否做全队多装递减，
     * 并且效果也是乘法」→「墨潮电子舱就照全队递减的乘法」）。
     *
     * 旧口径（2026-09-26 立的 `sum` 档）写的是「同舰多件加和（上限 90%）· 多舰乘法叠加」——
     * 那条下 4 舰各 3 件就到 90.8%、把敌人射程一路压到地板 3,000 m（玩家报障）。
     * 现口径由core的weightedGapFleet判定：舰内逐件递减，舰间乘法合成并限制整队上限。
     */
    // ⟪文案调整 2026-10-09⟫ 启动加速仅本舰递减，不能套用电子压制60%封顶说明。
    lines.push({ k: tr("ui.shipInfo.076"), v: tr(st.kind === 'drone-launch' ? 'ui.shipInfo.079' : 'ui.shipInfo.201') })
  } else {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr("ui.shipInfo.079") })
  }
  /**
   * **机群结构层加成**（**2026-09-27 船长问：「鱿蜂结构层是否真的对无人机生效？」**）：
   * 生效是真的（`combat.ts:2059` 把本舰各模块的 `droneHullHpBonusPct` 求和进 `UnitSpec`，
   * `combat.ts:7663` 放飞无人机时按它放大结构层），**但卡面原先没有这一行** ⇒
   * 说明写着「机群结构层 +80%」而玩家在卡上找不到。**任何槽位都可能带** ⇒ 与其它"跨槽位旋钮"同段处理。
   *
   * ⚠ **行名用 `ui.shipInfo.210`（只有名字、没有占位符）**：**2026-09-27 船长报障**
   * 「机群结构层 +{p1}」——原先这里挂的是**整句** `ui.shipInfo.202`（`机群结构层 +{p1}`），
   * 而行名栏只放名字、数值另起一栏 ⇒ `{p1}` 无人供给、原样漏给玩家。
   * ⚠ 合并（2026-09-27）：该 id 原为 `.205`，与「无人机储备甲板」撞号 ⇒ 顺移到 `.210`。
   */
  if ((mod.droneHullHpBonusPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.210"), v: `+${pct(mod.droneHullHpBonusPct ?? 0)}` })
  }
  /**
   * **损伤管制装置的启动规格**（2026-09-27 · data-map 甲案「说明不再手写数字、数值由卡面参数行渲染」）：
   * 行名 = `ui.shipInfo.024`「运转消耗」族的口径——这里用**独立行名 + 值**两段，时长读引擎常量 `DC_LOCK_MS`。
   */
  if (mod.hullSaveKit !== undefined) {
    lines.push({
      k: tr("ui.shipInfo.203"),
      v: tr("ui.shipInfo.204", { p1: Math.round(DC_LOCK_MS / 1000) }),
    })
  }
  if (mod.cpuUse !== undefined) lines.push({ k: tr("ui.shipInfo.169"), v: fmt(mod.cpuUse) })
  /**
   * **多装递减装备的「有效值（原值）」**（**2026-09-29 船长令**）——已装卡专有（`engine + shipId` 都有才行）；
   * 放在这里一次性收口：任何槽位分支都不用各自接线，新增递减件自动被覆盖。
   */
  if (shipId !== undefined && engine !== undefined) {
    const dec = fittedDecayLine(engine, shipId, mod, ordinal)
    if (dec) lines.push(dec)
    const baseCycle = mod.shieldFieldMs ?? (mod.shieldPulsePct ? SHIELD_PULSE_MS : undefined) ??
      ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0 ? mod.repairIntervalMs ?? 5000 : undefined) ??
      mod.captureWebCycleMs ?? mod.droneReviveCycleMs
    if (baseCycle !== undefined) lines.push({ k: tr('ui.equipmentPenalty.001'), v: tr('ui.equipmentPenalty.002', {
      p1: (mod.droneReviveCycleMs !== undefined
        ? droneReviveCycleMsOf(engine.state, engine.ctx, shipId, baseCycle)
        : equipmentCycleMsOf(engine.state, engine.ctx, shipId, baseCycle)) / 1000, p2: baseCycle / 1000,
    }) })
  }
  return lines
}
