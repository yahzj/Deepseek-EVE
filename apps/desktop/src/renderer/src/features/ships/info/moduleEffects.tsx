/** 功能域职责拆分，保持原计算与顺序。 */
import { type ModuleDef, SHIELD_FIELD_COST_PCT, SHIELD_PULSE_MS, type DamageType, FOE_RANGE_DEBUFF_FLOOR_M, MY_WEB_RANGE_M, stackingOf, type ModuleSlot } from '@whale/core'
import { tr } from '../../../i18n/locale'
import { pctOpt, turretAmmoText, rangeText, recoveryPct, pct, resistGapText, thrusterCycleShort, fmt, salvageCycleSecs, reviveCycleSecs, DMG_LABEL, repairShortText, hullResistShortText } from './primitives'

/** 短效文案（装配台槽位行 / 装备库行 / 手册网格共用；V18.1 收敛件尾注"多装递减"） */
export function moduleShortEffect(mod: ModuleDef): string {
  let body = ''
  switch (mod.slot) {
    case 'miner':
      body = tr("ui.shipInfo.097", { p1: pctOpt(mod.bonus) })
      break
    case 'cargo':
      body = tr("ui.shipInfo.098", { p1: pctOpt(mod.bonus) })
      break
    case 'turret': {
      body = tr("ui.shipInfo.099", { p1: turretAmmoText(mod), p2: rangeText(mod.minRangeM, mod.maxRangeM) })
      break
    }
    case 'missile': {
      // V18B-1 导弹架：爆炸系武器形态（爆破弹药，近盲安全射距 + 追踪命中）
      body = tr("ui.shipInfo.100", { p1: rangeText(mod.minRangeM, mod.maxRangeM) })
      break
    }
    case 'laser': {
      // V18B-2 激光炮：能量系武器形态（能量弹药 · 必中 · 威力随距离轻微衰减）
      body = tr("ui.shipInfo.101", { p1: rangeText(mod.minRangeM, mod.maxRangeM) })
      /**
       * **R 族「叠光激光炮」的短行**（**船长 2026-10-01 令**：「激光武器为叠光同款叠加攻速的，基础伤害偏低，
       * 需要玩家叠满才威力较强」）——补「装填自加速」那一段（换装卡/装备库行上要看得见"会越打越快"）。
       * 秒数取件自带字段（起步装填 / 每发缩短 / 下限），并**跟着武器加成缩放**口径无关 ⇒ 原值直读。
       */
      if (mod.overlayDrive) {
        const bl = tr("ui.shipInfo.246", {
          p1: ((mod.reloadMs ?? 0) / 1000).toFixed(1),
          p2: (mod.overlayDrive.stepMs / 1000).toFixed(1),
          p3: (mod.overlayDrive.floorMs / 1000).toFixed(1),
        })
        body = body ? `${body} · ${bl}` : bl
      }
      break
    }
    case 'shield-field': {
      /**
       * 护盾充能力场装置（2026-09-20 船长）：**高槽 · 护盾族**。
       * 短行必须自己一支 —— 与中槽 `shield` 那条（「每 N 秒回盾 x（按满盾）」）不同：
       * 本件排除自身、按需扣盾，冷却按件自带（`mod.shieldFieldMs`）。
       */
      const parts: string[] = []
      const ms = mod.shieldFieldMs ?? 0
      if ((mod.shieldFieldPct ?? 0) > 0 && ms > 0) {
        // ⟪文案调整 2026-10-07⟫ 力场扣盾代价与结算同源。
        parts.push(tr("ui.shipInfo.181", { p1: Math.round(ms / 1000), p2: recoveryPct(mod.shieldFieldPct ?? 0), p3: recoveryPct(SHIELD_FIELD_COST_PCT) }))
      }
      body = parts.join(' · ')
      break
    }
    case 'shield': {
      const parts: string[] = []
      if (mod.shieldHpBonus !== undefined) parts.push(tr("ui.shipInfo.102", { p1: pct(mod.shieldHpBonus) }))
      const gap = resistGapText(mod.shieldResistAdd)
      if (gap) parts.push(gap)
      // 护盾充能装置按本舰最大护盾恢复，周期与比例直接读取单点。
      // ⚠ 它只有 `shieldPulsePct` 一个效果字段，原先短行**拼出空串**（船长报障「装配时候的卡片上没有说明」）
      // 秒数取core单点SHIELD_PULSE_MS。
      if ((mod.shieldPulsePct ?? 0) > 0) {
        parts.push(tr("ui.shipInfo.103", { p1: SHIELD_PULSE_MS / 1000, p2: recoveryPct(mod.shieldPulsePct ?? 0) }))
      }
      body = parts.join(' · ')
      break
    }
    case 'armor': {
      const parts: string[] = []
      if (mod.armorHpBonus !== undefined) parts.push(tr("ui.shipInfo.104", { p1: pct(mod.armorHpBonus) }))
      const gap = resistGapText(mod.armorResistAdd)
      if (gap) parts.push(gap)
      // 结构层容量（E 族巨构骨架）：短行也要看得见"最后那段血更厚"
      if ((mod.hullHpBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.105", { p1: pct(mod.hullHpBonus ?? 0) }))
      // 2026-09-10 船长：重甲件的机动代价（陵寝装甲层 −25%）——短行也带代价（同推进器「命中×0.85」写法）
      if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(tr("ui.shipInfo.106", { p1: (1 - (mod.speedPenaltyPct ?? 0)).toFixed(2) }))
      body = parts.join(' · ')
      break
    }
    case 'propulsion': {
      // 2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」——
      // 短行（换装卡 / 装备库行 / 手册网格）此前只有「速度 +X% · 命中×Y」，看不出是**周期**爆发，
      // 补周期缀（秒数同源于 balance.battle，见 core thrusterCycleText；**2026-09-14 起按件取值**：
      // 件自带覆盖（微型跃迁引擎 10 秒点火）时以件为准）
      const parts: string[] = []
      if (mod.speedBonusPct !== undefined)
        parts.push(tr("ui.shipInfo.107", { p1: pct(mod.speedBonusPct), p2: thrusterCycleShort(mod) }))
      if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) parts.push(tr("ui.shipInfo.108", { p1: (1 - mod.hitPenalty).toFixed(2) }))
      body = parts.join(' · ')
      break
    }
    case 'drone-rack':
      body = tr("ui.shipInfo.109", { p1: fmt(mod.droneBayBonusM3) })
      break
    case 'salvager':
      // 2026-09-14 补（与护盾充能装置同批查出）：**打捞器短行此前也是空的**——本模板**漏了 salvager 这个槽位分支**
      body = tr("ui.shipInfo.110", { p1: salvageCycleSecs(mod) })
      break
    case 'drone-tac':
      body = tr("ui.shipInfo.111", { p1: pctOpt(mod.droneDmgBonus) })
      break
    case 'drone-relay':
      // 2026-09-10 无人机中继天线：放飞无人机射程加成
      body = tr("ui.shipInfo.112", { p1: pctOpt(mod.droneRangeBonusPct) })
      break
    case 'drone-launch':
      body = tr('ui.launchCalibration.001', { p1: Math.round((mod.droneLaunchCutPct ?? 0) * 100) })
      break
    case 'drone-deck':
      /**
       * 无人机储备甲板（2026-09-27 船长令）：短行报**复位周期秒数**。
       * ⚠ 秒数从 `droneReviveCycleMs` **现算**（不手写数字 —— 本会话定的甲案：
       * 说明文案里不写数值，数值只从界面参数行出）。
       */
      body = tr("ui.shipInfo.205", { p1: reviveCycleSecs(mod) })
      break
    case 'drone-shield':
      // 2026-09-27 无人机护盾投射仪（中槽）：只加放飞无人机的护盾层
      // ⚠ 合并：该族 id 与储备甲板撞号 ⇒ 顺移到 `.209`（见 l10n 表内注释）。
      body = tr("ui.shipInfo.209", { p1: pctOpt(mod.droneShieldHpBonusPct) })
      break
    case 'support': {
      // V18.1 支援件：效果字段判别（稳定器按系可多件 → 逐系列出）
      const dmg = mod.damageTypeBonusPct
      if (mod.blink) {
        // ⟪文案调整 2026-10-19⟫ 短距跃迁改归战斗支援，沿用受击触发短行。
        body = tr('ui.shipInfo.247', {
          p1: (mod.blink.distanceM / 1000).toFixed(mod.blink.distanceM % 1000 === 0 ? 0 : 1),
          p2: Math.round(mod.blink.cooldownMs / 1000),
        })
      } else if (mod.rebirthRepair) {
        const d = mod.rebirthRepair
        body = tr('ui.gravekeeperGear.002', { p1: d.repairMs / 1000, p2: d.armorTotalPct * 100, p3: d.hullTotalPct * 100 })
      } else if (mod.crisisOverload) {
        const d = mod.crisisOverload
        body = tr('ui.gravekeeperGear.004', { p1: d.rangeBonusPct * 100, p2: d.damageBonusPct * 100, p3: d.speedPenaltyPct * 100 })
      } else if (mod.laserFalloffBonus !== undefined) {
        body = tr('ui.launchCalibration.002', { p1: mod.laserFalloffBonus })
      } else if (dmg && Object.keys(dmg).length > 0) {
        body = Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => tr("ui.shipInfo.113", { p1: DMG_LABEL[t as DamageType], p2: pct(v ?? 0) }))
          .join(' + ')
      } else if (mod.reloadCutPct !== undefined) {
        body = tr("ui.shipInfo.114", { p1: pct(mod.reloadCutPct) })
      } else if (mod.hitBonusPct !== undefined) {
        body = tr("ui.shipInfo.115", { p1: pct(mod.hitBonusPct) })
      } else if (mod.evasionGapPct !== undefined) {
        body = tr("ui.shipInfo.116", { p1: pct(mod.evasionGapPct) })
      } else if (mod.warpSpeedBonusPct !== undefined) {
        // 2026-09-14 跃迁计算机（低槽支援件）：只缩短**星系际航行**时间，不碰战斗机动
        body = tr("ui.shipInfo.117", { p1: pct(mod.warpSpeedBonusPct) })
      } else if (mod.stealthMs !== undefined) {
        // 2026-09-15 隐秘行动装置（高槽支援件）：开火前隐身——短行必须写明"开火即现形"与推进器禁令
        body = tr("ui.shipInfo.118", { p1: mod.stealthMs / 1000 })
      } else if (mod.foeRangeDebuffPct !== undefined) {
        /**
         * 2026-09-26 墨潮电子舱（H 族势力装备 · 高槽支援件）：敌方武器射程压制。
         * ⚠ **同日船长报障**：「**发现BUG，墨潮电子舱怎么写着全额叠加，并且没有写上最短射程3000m**」
         * ⇒ 短行补上**最短射程**（数值取引擎单点 `FOE_RANGE_DEBUFF_FLOOR_M`，界面不写死 3000）。
         */
        body = tr("ui.shipInfo.185", { p1: pct(mod.foeRangeDebuffPct), p2: String(FOE_RANGE_DEBUFF_FLOOR_M) })
      } else if (mod.captureWebCycleMs !== undefined) {
        /**
         * 2026-09-26 墨潮捕获网（H 族势力装备 · 高槽支援件）：周期张网。
         *
         * ⚠ **2026-09-29 船长报障**：「墨潮捕获网现在各种属性都只显示在说明文本内。**而且还有重复文本**。
         * 将一些关键属性（比如射程，减速幅度）放进属性里」——
         * ① 射程原先取**引擎常量** `MY_WEB_RANGE_M`，现在改取**件上字段**（缺省回落常量）；
         * ② 说明里那串数字同步撤掉，数值只由**卡面参数行**渲染（甲案）。
         */
        body = tr("ui.shipInfo.186", {
          p1: Math.round(mod.captureWebCycleMs / 1000),
          p2: String(mod.captureWebRangeM ?? MY_WEB_RANGE_M),
        })
      }
      break
    }
    case 'target-lock':
      // 2026-09-09 目标锁定阵列：集火首位 + 目标受击加深；**2026-09-17 船长：增伤与集火都改「全队生效」**
      body = tr("ui.shipInfo.119", { p1: pctOpt(mod.lockDmgBonus) })
      break
    case 'cpu':
      // 2026-09-11 协处理器：装配 CPU 预算扩容（本件自身不占 CPU——说清，否则玩家会以为要占 0 是 bug）
      body = tr("ui.shipInfo.120", { p1: fmt(mod.cpuBonus) })
      break
    case 'plug': {
      /**
       * **舰船插件**（**2026-09-26 船长令**，见 `docs/design/ship-plug-20260926.md`）：
       * 12 件各自一类效果 ⇒ 逐类拼短行（与支援件那支同款"按字段判别"）。
       * ⚠ 装配页卡片**必须非空**：`content:check` 的「短效说明为空」契约会红。
       */
      const bits: string[] = []
      if (mod.stealthWithPropulsion) bits.push(tr('ui.factionPlug.001'))
      if (mod.shieldArmorConversionPct !== undefined) bits.push(tr('ui.factionPlug.002', { p1: pct(mod.shieldArmorConversionPct) }))
      if (mod.shieldPassiveBonusPct !== undefined) bits.push(tr('ui.factionPlug.003', { p1: pct(mod.shieldPassiveBonusPct) }))
      if (mod.cargoCapacityBonusPct !== undefined) bits.push(tr('ui.factionPlug.004', { p1: pct(mod.cargoCapacityBonusPct) }))
      if (mod.cpuPenalty !== undefined) bits.push(tr('ui.factionPlug.005', { p1: fmt(mod.cpuPenalty) }))
      if (mod.dronePrinting) bits.push(tr('ui.factionPlug.006', {
        hp: pct(1 - mod.dronePrinting.hpMul), damage: pct(1 - mod.dronePrinting.damageMul),
        launch: pct(1 - mod.dronePrinting.launchMul), deck: pct(1 - mod.dronePrinting.deckCycleMul),
      }))
      if (mod.shieldHpAdd !== undefined) bits.push(tr('ui.shipInfo.187', { p1: fmt(mod.shieldHpAdd) }))
      if (mod.armorHpAdd !== undefined) bits.push(tr('ui.shipInfo.188', { p1: fmt(mod.armorHpAdd) }))
      if (mod.hullHpAdd !== undefined) bits.push(tr('ui.shipInfo.189', { p1: fmt(mod.hullHpAdd) }))
      if (mod.midSlotsAdd !== undefined) bits.push(tr('ui.shipInfo.190', { p1: fmt(mod.midSlotsAdd) }))
      if (mod.lowSlotsAdd !== undefined) bits.push(tr('ui.shipInfo.191', { p1: fmt(mod.lowSlotsAdd) }))
      if (mod.cpuBonus !== undefined) bits.push(tr('ui.shipInfo.192', { p1: fmt(mod.cpuBonus) }))
      if (mod.damageBonusPct !== undefined) bits.push(tr('ui.shipInfo.193', { p1: pct(mod.damageBonusPct) }))
      if (mod.hitBonusPct !== undefined) bits.push(tr('ui.shipInfo.194', { p1: pct(mod.hitBonusPct) }))
      if (mod.speedAddMps !== undefined) bits.push(tr('ui.shipInfo.195', { p1: fmt(mod.speedAddMps) }))
      if (mod.speedPenaltyMps !== undefined) bits.push(tr('ui.shipInfo.196', { p1: fmt(mod.speedPenaltyMps) }))
      if (mod.rangeCutPct !== undefined && mod.rangeCutPct < 0) bits.push(tr('ui.shipInfo.197', { p1: pct(-mod.rangeCutPct) }))
      if ((mod.plugRangeBonusPct ?? 0) > 0) bits.push(tr('ui.shipInfo.197', { p1: pct(mod.plugRangeBonusPct ?? 0) }))
      if (mod.targetWeightMul !== undefined) {
        bits.push(mod.targetWeightMul > 1 ? tr('ui.shipInfo.198') : tr('ui.shipInfo.199'))
      }
      // 插件**不可拆**：短行末尾统一带一句（这是它与普通装备最要紧的差别）
      body = `${bits.join(' · ')}${bits.length > 0 ? ' · ' : ''}${tr('ui.shipInfo.200')}`
      break
    }
  }
  // 任何槽位统一尾缀：维修系（每跳修多少/吃不吃组件）、结构层抗性与**跨族加成**——短行不丢关键效果
  // （跨族尾缀 = 2026-09-11 修复：赃物强化舱的"甲容 +15%"这类搭车加成因槽位分支而漏显示）
  const extras = [repairShortText(mod), hullResistShortText(mod), crossFamilyShort(mod)].filter(Boolean).join(' · ')
  if (extras) body = body ? `${body} · ${extras}` : extras
  // V18.1：收敛件（抗性/闪避 = 缺口复合、命中/速度 = EVE 曲线）尾注"多装递减"；
  // 2026-09-15 隐秘行动装置（`max` 组）= **取最长一件、不叠加** ⇒ 既不标"多装递减"也不标"全额叠加"；
  // ⚠ **2026-09-29**：墨潮电子舱改归 `fleetDecay`（全队折权缺口乘法）⇒ 它**开始**挂"多装递减"
  //   （旧 `sum` 组"同舰加和、上限内不打折"已作废，当时正因不衰减而排除在外）。
  const stShort = stackingOf(mod).group
  return body + (mod.unique === true || stShort === 'flat' || stShort === 'max' ? '' : tr('ui.shipInfo.179'))
}

/** 跨族加成的**短行**文本（装配台槽位行 / 装备库行 / 手册网格共用；与上面的信息卡同源口径） */
export function crossFamilyShort(mod: ModuleDef): string {
  const parts: string[] = []
  const foreign = (owner: ModuleSlot): boolean => mod.slot !== owner
  if (foreign('armor')) {
    if (mod.armorHpBonus !== undefined) parts.push(tr("ui.shipInfo.104", { p1: pct(mod.armorHpBonus) }))
    if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(tr("ui.shipInfo.106", { p1: (1 - (mod.speedPenaltyPct ?? 0)).toFixed(2) }))
  }
  if (foreign('shield') && mod.shieldHpBonus !== undefined) parts.push(tr("ui.shipInfo.102", { p1: pct(mod.shieldHpBonus) }))
  if (foreign('propulsion')) {
    if (mod.speedRamp)
      parts.push(tr('ui.alienLoot.004', { p1: (mod.speedBonusPct ?? 0) * 100, p2: mod.speedRamp.maxBonusPct * 100, p3: mod.speedRamp.rampMs / 1000 }))
    else if (mod.speedBonusPct !== undefined)
      parts.push(tr("ui.shipInfo.107", { p1: pct(mod.speedBonusPct), p2: thrusterCycleShort(mod) }))
    if ((mod.hitPenalty ?? 0) > 0) parts.push(tr("ui.shipInfo.108", { p1: (1 - (mod.hitPenalty ?? 0)).toFixed(2) }))
  }
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) parts.push(tr("ui.shipInfo.146", { p1: fmt(mod.droneBayBonusM3 ?? 0) }))
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.111", { p1: pct(mod.droneDmgBonus ?? 0) }))
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) parts.push(tr("ui.shipInfo.112", { p1: pct(mod.droneRangeBonusPct ?? 0) }))
  if (foreign('drone-shield') && (mod.droneShieldHpBonusPct ?? 0) > 0) parts.push(tr("ui.shipInfo.209", { p1: pct(mod.droneShieldHpBonusPct ?? 0) }))
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) parts.push(tr("ui.shipInfo.147", { p1: pct(mod.lockDmgBonus) }))
  if (foreign('cpu') && (mod.cpuBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.148", { p1: fmt(mod.cpuBonus ?? 0) }))
  /** 机群结构层加成（2026-09-27 补）：**任何槽位都可能带** ⇒ 与上面几条"跨槽位旋钮"同段，不进 `foreign()` 判据 */
  if ((mod.droneHullHpBonusPct ?? 0) > 0) parts.push(tr("ui.shipInfo.202", { p1: pct(mod.droneHullHpBonusPct ?? 0) }))
  /** 对方对机群的命中收窄（2026-09-29 船长令：巨构导控塔）：同上，任何槽位都可能带 */
  if ((mod.droneHitGapPct ?? 0) > 0) parts.push(`${tr("ui.shipInfo.211")} ${tr("ui.shipInfo.212", { p1: pct(mod.droneHitGapPct ?? 0) })}`)
  return parts.join(' · ')
}
