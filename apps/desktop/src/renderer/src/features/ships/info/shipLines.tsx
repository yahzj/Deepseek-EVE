/** 功能域职责拆分，保持原计算与顺序。 */
import { tr } from '../../../i18n/locale'
import { type UnitSpec, type BattleBalance, battleSpeedBonusOf, thrusterCycleNote, type ShipDef, shipCategoryKeyOf, type DamageType } from '@whale/core'
import { type InfoLine, fmt, resistsText, DMG_LABEL, DmgChip, pct, slotListText, warpChargePct } from './primitives'
import { shipSubClassText, shipRoleText, shipTierText } from '../../../ui/labelsText'

/**
 * **另有一处同值展示**、不要再重复输出的基础行（`ui:attr-check` 按「不重名」体检）。
 *
 * 由来（2026-09-26 船长报障「无人机舱有2个重复的」「用机动速度替换所有动力的位置」）：
 * `shipInfoLines` 给的是**船体静态行**，而装配页在它之上还有右栏区块与装后口径行、
 * 图鉴档案窗在它之上还有三个静态行与血量徽章 ⇒ 同一名字会出现两次（出现过：无人机舱 ×2、
 * 机动速度 ×2）。凡"本页别处已经报过同一个数"的基础行都登记进本表：
 * - 装配页（`pages/FitPage.tsx`）：右栏有无人机舱舱容条 ＋ 主表另有合计行与装后机动速度行；
 * - 图鉴档案窗 / 舰船蓝图产物（`panels/Handbook.tsx`）：上方静态行已报机动速度（船体基础值）、
 *   顶部徽章已报三层血量，`无人机舱 = 无` 对无机舱的船只是白占一行。
 */
export const FIT_MAIN_HIDDEN_KEYS = (): readonly string[] => [
  tr("ui.FitPage.010"), // 无人机舱：装配页右栏有舱容条 + 合计行；图鉴上方静态行已有
  tr("ui.FitPage.049"), // 机动速度：装配页另有装后口径行；图鉴上方静态行已有（船体基础值）
]

/**
 * 装配页主属性表里被**装后合成行**取代的战斗基础行（由 `FitPage` 过滤，避免基础/合成重复）。
 * 火力加成例外——船长 2026-09-05：不入血量徽章组，作为下方属性行展示，故不在本表内。
 * 2026-09-26 从 `FitPage.tsx` 挪到此处：与 `FIT_MAIN_HIDDEN_KEYS` 同源，供 `npm run ui:attr-check` 体检。
 */
export const COMBAT_BASE_KEYS = (): ReadonlySet<string> => new Set([
  tr("ui.FitPage.001"),
  tr("ui.FitPage.002"),
  tr("ui.FitPage.003"),
  tr("ui.FitPage.004"),
  tr("ui.ShipPage.023"),
  tr("ui.FitPage.005"),
  tr("ui.FitPage.006"),
  tr("ui.FitPage.007"),
])

/**
 * **机动速度行（装后口径）** —— 一个构造点，装配页主表与舰队页悬停卡共用。
 *
 * 口径（2026-09-11 船长「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」）：
 * 推进器周期化（2026-09-10）后 `spec.speedMps` **不含**推进器加成（加成走 `thrusterBoost`、
 * 只在点火窗口生效）⇒ 本行 = 基础值 ＋（装了推进器时）点火期值 ＋ 周期尾缀，秒数与 balance 同源。
 * **2026-09-14 起按船取值**：周期取自本船 spec 的两个覆盖字段（微型跃迁引擎 = 10 秒点火）。
 */
export function fittedSpeedLine(spec: Pick<UnitSpec, 'speedMps'> & Partial<UnitSpec>, battle: BattleBalance): InfoLine {
  return {
    k: tr("ui.FitPage.049"),
    v: (
      <>
        {`${fmt(Math.round(spec.speedMps * (1 + battleSpeedBonusOf(spec, { startedAtGameMs: 0, lastTickGameMs: 0 }, false))))} m/s`}
        {spec.thrusterBoost !== undefined && spec.thrusterBoost > 0 ? (
          <span className="app-dim">
            {/* 点火周期按语言（2026-09-30 批 5）：`thrusterCycleNote` 给 { textId, params }，原来直接把中文串喂进 {p2} */}
            {tr("ui.FitPage.145", {
              p1: fmt(Math.round(spec.speedMps * (1 + battleSpeedBonusOf(spec, { startedAtGameMs: 0, lastTickGameMs: 0 })))),
              p2: (() => {
                const note = thrusterCycleNote(battle, { boostMs: spec.thrusterBoostMs, cooldownMs: spec.thrusterCooldownMs })
                return tr(note.textId, note.params)
              })(),
            })}
          </span>
        ) : null}
      </>
    ),
  }
}

/** 装后无人机舱合计行（船体 + 已装「甲板扩展」）——装配页主表与舰队页悬停卡共用同一行 */
export function fittedDroneBayLine(totalM3: number): InfoLine {
  return { k: tr("ui.FitPage.035"), v: tr("ui.FitPage.143", { droneBayTotal: totalM3 }) }
}

/**
 * **装后货舱容量行**（**2026-10-02 船长报障**：「发现遗漏，装配界面的属性中无法查看舰船当前货仓大小」）。
 *
 * 为什么需要它：装配页主表把「货舱容量」这条**基础行**过滤掉了（登记在 `fitHiddenBaseKeys()`），
 * 却一直**没给装后口径的替代行** ⇒ 整张属性表里查不到货舱大小。标签**复用**船卡那一行
 * （`ui.Handbook.010`「货舱容量 / Cargo capacity」），值口径也与船卡一致（`N m³`）。
 *
 * 口径 = core 单点 `cargoCapacityM3Of`：船体基础 ×（1 + 货舱扩展件加成）× 深空物流学 × 货舱管理学
 * ×（货舰另乘）货舰操作 —— 即"**装后**"的当前容量（船体基础值见船卡 / 图鉴那条路）。
 */
export function fittedHoldLine(capM3: number): InfoLine {
  return { k: tr("ui.Handbook.010"), v: `${fmt(capM3)} m³` }
}

/**
 * **装配页"原地过滤掉"的基础行**（这些行的数字在本页另有出处，或已被装后行取代）。
 * 供 `pages/FitPage.tsx` 与 `npm run ui:attr-check` **共用一份**（口径不许在两处各写一遍）。
 *
 * ⚠ **必须是函数、不能是模块级常量**，也**不许**写成中文字面量比对 —— 2026-10-02 实测的病根：
 * 装配页原先写 `l.k !== 槽位 / 采集性能 / 货舱容量`（以为 `shipInfoLines` 给的是中文 key），
 * 而这三条其实早已走 `tr(ui.Handbook.00x)` **按语言出词** ⇒ **英文界面下一律不命中**：
 * 那三条基础行照常显示（与装后行重复，且报的是船体基础值）。本函数按 **id 取当前语言的 label**，
 * 与 `shipInfoLines()` 在同一时刻求值 ⇒ 两种语言同口径。
 */
export function fitHiddenBaseKeys(): readonly string[] {
  return [
    tr('ui.Handbook.008'), // 槽位：本页右栏按槽位分组逐格列出（`slotListText` 那行是船表口径）
    tr('ui.Handbook.011'), // 采集性能：本页没有采集上下文（周期 / 每次产量在矿带与采矿页）
    tr('ui.Handbook.010'), // 货舱容量：由装后行 `fittedHoldLine()` 取代
    'CPU', // CPU 上限：本页右栏「CPU 剩余」条（含技能与协处理器扩容）—— 这个 key 本来就是语言无关字面量
  ]
}

/**
 * **装后属性行**（船长 2026-09-26：「我的舰队页面中，玩家鼠标悬停舰船时，应该显示舰船的当前
 * 属性，而不是基础属性」）——舰队悬停卡专用，把下列基础值换成 `createPlayerSpec` 的合成值：
 *
 * ① 三层血量与三系抗性（含容量件与抗性件的 EVE 式缺口合成；图鉴侧仍按船长同日裁定走**基础属性**）；
 * ② 回避率、命中加成（姿态陀螺缺口 / 舰种操作技能）；③ 机动速度（航行技能 ＋ 重甲机动代价 ＋
 * 推进器点火期）；④ 无人机舱合计（船体 ＋ 甲板扩展）。
 *
 * ⚠ **不追加间接属性块**（船长 2026-09-26 复令：「看了下，不要显示显示间接属性，过于臃肿」）——
 * 悬停卡只报"当前属性的核心一屏"；完整间接属性（动力/跃迁/质量/锁定/信号/扫描/充能）看装配页，
 * 图鉴档案那条路另有船长令要求带上（见 `panels/Handbook.tsx` 自己追加）。
 *
 * `droneBayTotal` 不传 = 不追加合计行。其余行（定位/货舱/采集/槽位/CPU/无人机舱）本来就是静态值，不动。
 */
export function shipCurrentLines(
  ship: ShipDef,
  spec: UnitSpec,
  opts: { battle: BattleBalance; droneBayTotal?: number },
): InfoLine[] {
  const replaced = new Map<string, InfoLine>()
  // 装后合成值（键与 `shipInfoLines` 的基础行同 id，逐条顶替）
  replaced.set(tr("ui.FitPage.001"), { k: tr("ui.FitPage.001"), v: fmt(spec.hp.s) })
  replaced.set(tr("ui.FitPage.002"), { k: tr("ui.FitPage.002"), v: resistsText(spec.resists.shield) })
  replaced.set(tr("ui.FitPage.003"), { k: tr("ui.FitPage.003"), v: fmt(spec.hp.a) })
  replaced.set(tr("ui.FitPage.004"), { k: tr("ui.FitPage.004"), v: resistsText(spec.resists.armor) })
  replaced.set(tr("ui.ShipPage.023"), { k: tr("ui.ShipPage.023"), v: fmt(spec.hp.h) })
  replaced.set(tr("ui.FitPage.005"), { k: tr("ui.FitPage.005"), v: resistsText(spec.resists.hull) })
  replaced.set(tr("ui.FitPage.006"), { k: tr("ui.FitPage.006"), v: `+${Math.round(spec.hitBonus * 100)}%` })
  replaced.set(tr("ui.FitPage.007"), { k: tr("ui.FitPage.007"), v: `${Math.round(spec.evasion * 100)}%` })
  replaced.set(tr("ui.FitPage.049"), fittedSpeedLine(spec, opts.battle))
  if (opts.droneBayTotal !== undefined && opts.droneBayTotal > 0) {
    replaced.set(tr("ui.FitPage.010"), fittedDroneBayLine(opts.droneBayTotal))
  }
  const out: InfoLine[] = []
  for (const line of shipInfoLines(ship)) {
    const hit = replaced.get(line.k)
    // 有装后行 ⇒ 用装后行顶替；给了机舱合计 ⇒ 基础机舱行让位；其余原样保留
    if (hit) out.push(hit)
    else if (FIT_MAIN_HIDDEN_KEYS().includes(line.k)) continue
    else out.push(line)
  }
  return out
}

/**
 * **当前属性卡的拼装口径**（不取值）——供 `npm run ui:attr-check` 复算"舰队页悬停卡"这张表。
 * 返回三段读数，与 `shipCurrentLines` 同一段逻辑（改口径只会改这一处）：
 * - `replaced`：被装后行**顶替**的键（位置不变、值换掉）；
 * - `hidden`  ：被**移走**的键（本卡另有同值行的那些，如有机舱合计时的基础机舱行）；
 * - `keys`    ：整卡最终的行 key 序列（**不含**间接属性块——船长 2026-09-26「过于臃肿」已去掉）。
 */
export function shipCurrentLayout(
  ship: ShipDef,
  hasDroneBayTotal: boolean,
): { replaced: string[]; hidden: string[]; keys: string[] } {
  const replaced = new Set<string>([
    tr("ui.FitPage.001"),
    tr("ui.FitPage.002"),
    tr("ui.FitPage.003"),
    tr("ui.FitPage.004"),
    tr("ui.ShipPage.023"),
    tr("ui.FitPage.005"),
    tr("ui.FitPage.006"),
    tr("ui.FitPage.007"),
    tr("ui.FitPage.049"),
    ...(hasDroneBayTotal ? [tr("ui.FitPage.010")] : []),
  ])
  const keys: string[] = []
  const hidden: string[] = []
  for (const line of shipInfoLines(ship)) {
    if (replaced.has(line.k)) keys.push(line.k)
    else if (FIT_MAIN_HIDDEN_KEYS().includes(line.k)) hidden.push(line.k)
    else keys.push(line.k)
  }
  return { replaced: [...replaced], hidden, keys }
}

/**
 * **图鉴类窗口的舰船基础行（单点）** —— 手册「舰船档案窗」与「舰船蓝图产物」**两处同一口径**。
 *
 * 两条规则都由船长报障定下，别再各写一份（此前 `Handbook.tsx` 两处各写一遍、`tools/ui-attr-check.ts`
 * 又抄了第三份，三份口径互不相同）：
 * ① **「动力」滤掉** —— 下方 `shipIndirectLines` 的间接属性块会报一次（2026-09-26 船长报障
 *    「点击舰船图鉴内的舰船，当中的属性还是有动力，而没有机动速度」）；
 * ② **「无人机舱」真有舱才显示** —— 2026-09-27 船长报障「**而且还缺少无人机舱属性**」：
 *    此前档案窗是**无条件滤掉**，于是有舱的船也看不到机舱；而反过来无条件显示，又会让无舱的船
 *    白占一行「无人机舱 = 无」。⇒ 判据取 `droneBayM3 > 0`，只滤掉"无舱"那一种。
 */
export function shipCodexBaseLines(ship: ShipDef): ReturnType<typeof shipInfoLines> {
  const hasBay = (ship.droneBayM3 ?? 0) > 0
  return shipInfoLines(ship).filter(
    (l) => l.k !== tr('ui.Handbook.012') && (l.k !== tr('ui.FitPage.010') || hasBay),
  )
}

/** 舰船统一信息行：基础 + V10.5b 面板分组（护盾/装甲/结构区块各自血量与三系抗性；CPU/无人机舱） */
export function shipInfoLines(ship: ShipDef): InfoLine[] {
  const lines: InfoLine[] = [
    {
      k: tr("ui.Handbook.009"),
      // 2026-09-13 船长：**舰种子分类进界面**（只有虫洞族专属舰船写 `subClass`）
      // 2026-09-16 船长：类别名走 `shipCategoryKeyOf` + 本地化单点 `shipRoleText`
      // （装甲线 = `role: armored` 或武装舰里装甲占比 > 护盾占比）；舰级名同理走 `shipTierText`
      // （2026-09-26 报障修：原直读 core 的 `shipCategoryLabelOf` / `shipSizeLabel` ⇒ 英文界面下这行漏中文）
      v: `${ship.subClass ? `${shipSubClassText(ship.subClass)} · ` : ''}${shipRoleText(shipCategoryKeyOf(ship))} · ${shipTierText(ship.tier)}`,
    },
    // 2026-09-13 船长点名的三条**船体固有新机制**（只虫洞族专属舰船有；没有就不占行）
    ...(() => {
      const bits: string[] = []
      const rangeText = Object.entries(ship.weaponRangeBonusPct ?? {})
        .map(([t, v]) => tr("ui.shipInfo.123", { p1: DMG_LABEL[t as keyof typeof DMG_LABEL] ?? t, p2: Math.round((v ?? 0) * 100) }))
        .join(' · ')
      if (rangeText) bits.push(rangeText)
      if (ship.civilianFittingOnly === true) bits.push(tr('ui.shipInfo.249'))
      if (ship.droneLaunchCutPct) bits.push(tr('ui.launchCalibration.001', { p1: Math.round(ship.droneLaunchCutPct * 100) }))
      if (ship.fleetDamageBonusPct) bits.push(tr("ui.shipInfo.124", { p1: Math.round(ship.fleetDamageBonusPct * 100) }))
      if (ship.wormholeScanRadiusBonus) bits.push(tr("ui.shipInfo.125", { p1: ship.wormholeScanRadiusBonus }))
      // 2026-09-16 船长：后勤舰特性进「船体特性」栏（判据已由 `subClass` 改为数据字段，界面与引擎同源）
      if (ship.repairPulseTargetsFleet) bits.push(tr("ui.shipInfo.126"))
      // 2026-09-16 船长：**侦察舰特性**（「隐秘行动装置所需CPU降低50%，且移除推进器失效惩罚」）——
      // 同样走数据字段 ⇒ 引擎（`equipment.cpuUseOf` / `combat.createPlayerSpec`）与这里同源
      if (ship.stealthCpuMul !== undefined && ship.stealthCpuMul !== 1) {
        bits.push(tr("ui.shipInfo.127", { p1: ship.stealthCpuMul }))
      }
      if (ship.stealthIgnoresPropulsion === true) bits.push(tr("ui.shipInfo.128"))
      // 2026-09-18 船长：**电子舰特性 · 压制敌舰武器射程**（多艘乘法叠加 · 与敌方增程做加法 · 下限 3000m）
      if ((ship.foeRangeDebuffPct ?? 0) > 0) {
        bits.push(
          tr("ui.shipInfo.129", { p1: Math.round((ship.foeRangeDebuffPct ?? 0) * 100) }),
        )
      }
      // 2026-09-30 船长：**截击舰特性 · 不会被网子选为目标**（数据字段 `ShipDef.interceptorImmuneToWeb`；
      // 引擎消费点 = `combat.fireFoeCaptureWeb`，与这里同源）
      if (ship.interceptorImmuneToWeb === true) bits.push(tr("ui.shipInfo.245"))
      return bits.length > 0 ? [{ k: tr("ui.shipInfo.006"), v: bits.join(' · ') }] : []
    })(),
    { k: tr("ui.Handbook.010"), v: `${fmt(ship.cargoM3)} m³` },
    { k: tr("ui.Handbook.011"), v: tr("ui.shipInfo.130", { p1: ship.cycleSeconds, p2: ship.oreUnitsPerCycle }) },
    // 2026-09-26 船长：「动力没必要放入主属性内，用机动速度替换所有动力的位置」⇒ 本行由「动力」
    // （`agility`，已挪到间接属性）改为「机动速度」。无装配上下文（图鉴 / 悬停卡 / 蓝图产物）时
    // 取船表基础值 `maxSpeedMps`；装配页另有装后口径的同名行（含推进器点火期），见 `pages/FitPage.tsx`。
    ...(ship.maxSpeedMps !== undefined
      ? [{ k: tr("ui.FitPage.049"), v: `${fmt(ship.maxSpeedMps)} m/s` }]
      : []),
  ]
  const hasCombat = (ship.shieldHp ?? 0) > 0 || (ship.armorHp ?? 0) > 0 || (ship.hullHp ?? 0) > 0
  if (hasCombat) {
    lines.push({ k: tr("ui.FitPage.001"), v: fmt(ship.shieldHp) })
    lines.push({ k: tr("ui.FitPage.002"), v: resistsText(ship.shieldResist) })
    lines.push({ k: tr("ui.FitPage.003"), v: fmt(ship.armorHp) })
    lines.push({ k: tr("ui.FitPage.004"), v: resistsText(ship.armorResist) })
    lines.push({ k: tr("ui.ShipPage.023"), v: fmt(ship.hullHp) })
    lines.push({ k: tr("ui.FitPage.005"), v: resistsText(ship.hullResist) })
    if (ship.powerBonus !== undefined && ship.powerBonus > 0) {
      lines.push({ k: tr("ui.shipInfo.007"), v: `+${Math.round(ship.powerBonus * 100)}%` })
    }
    // 船体武器类型加成（2026-09-09 船长拍板：四族巡洋分型 EVE 式族加成）——同伤害类型武器单发加成、别的类型可用无加成
    // ⟪文案调整 2026-09-24⟫ 原「本族武器单发 +N%（装别族武器无加成）」是开发口径（"族"= 伤害类型键），
    //   玩家侧「族」另指敌方势力 ⇒ 船长报障「类似'武器族'这样的开发字眼会给玩家造成误导」。
    //   现正文走 `ui.shipInfo.008b`，写明"同类型 / 其它伤害类型"。
    if (ship.weaponFamilyBonus !== undefined) {
      for (const [t, v] of Object.entries(ship.weaponFamilyBonus)) {
        if ((v ?? 0) > 0) {
          lines.push({
            k: tr("ui.shipInfo.008"),
            v: (
              <>
                <DmgChip t={t as DamageType} label={tr("ui.shipInfo.131", { p1: DMG_LABEL[t as DamageType] })} />
                <span className="app-dim">{` ${tr("ui.shipInfo.184", { p1: pct(v ?? 0) })}`}</span>
              </>
            ),
          })
        }
      }
    }
    // V16.1：命中加成/回避率上主属性（装配台主要属性区内可见）
    if (ship.hitBonus !== undefined) lines.push({ k: tr("ui.FitPage.006"), v: `+${Math.round(ship.hitBonus * 100)}%` })
    if (ship.evasion !== undefined) lines.push({ k: tr("ui.FitPage.007"), v: `${Math.round(ship.evasion * 100)}%` })
  }
  lines.push({ k: tr("ui.Handbook.008"), v: slotListText(ship) })
  if (ship.cpu !== undefined) lines.push({ k: 'CPU', v: fmt(ship.cpu) })
  lines.push({ k: tr("ui.FitPage.010"), v: ship.droneBayM3 ? `${fmt(ship.droneBayM3)} m³` : tr("ui.BattleScreen.001") })
  return lines
}

/**
 * 间接属性行（速度/跃迁/质量/锁定/信号）：显示优先级低——仅装配界面使用。
 *
 * `effWarp`（2026-09-14 跃迁计算机）：装配页把手算好的**有效跃迁速度**（含装备加成）传进来
 * ⇒ 该行显示「基础 → 有效（含装备 +X%）」；**不传 = 显示船表基础值**（图鉴/船型档案那条路
 * 没有存档上下文，读数仍是档案值）。
 */
export function shipIndirectLines(ship: ShipDef, effWarp?: { aus: number; bonusPct: number }): InfoLine[] {
  const lines: InfoLine[] = []
  // 2026-09-26 船长：「动力没必要放入主属性内……动力放到间接属性里」＋「间接列删掉最大速度」
  // ⇒ 原主表的 `agility` 行挪到本块（列标题「间接属性」在装配页由 `ui.FitPage.034` 担任）；
  // 原「最大速度」行删除（主表已有「机动速度」，不再并列两个速度数字）。
  if (ship.agility !== undefined) lines.push({ k: tr("ui.Handbook.012"), v: `${Math.round(ship.agility * 100)}%` })
  if (ship.warpSpeedAus !== undefined) {
    const base = ship.warpSpeedAus
    const boosted = effWarp !== undefined && effWarp.bonusPct > 0 && Math.abs(effWarp.aus - base) > 1e-6
    lines.push({
      k: tr("ui.shipInfo.010"),
      v: boosted ? tr("ui.shipInfo.132", { base: base, p2: effWarp.aus.toFixed(2), p3: pct(effWarp.bonusPct) }) : `${base} AU/s`,
    })
  }
  if (ship.massKg !== undefined) lines.push({ k: tr("ui.shipInfo.011"), v: tr("ui.shipInfo.133", { p1: (ship.massKg / 1_000_000).toFixed(1) }) })
  if (ship.lockRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.012"), v: `${(ship.lockRangeM / 1000).toFixed(0)} km` })
  if (ship.signatureM !== undefined) lines.push({ k: tr("ui.shipInfo.013"), v: `${fmt(ship.signatureM)} m` })
  if (ship.scanResMm !== undefined) lines.push({ k: tr("ui.shipInfo.014"), v: `${fmt(ship.scanResMm)} mm` })
  // V16.1：跃迁充能（派生自动力 agility，动力越高充能越快；取代旧"起跳时间"）
  const charge = warpChargePct(ship)
  if (charge !== null) lines.push({ k: tr("ui.shipInfo.015"), v: `${charge}%` })
  return lines
}
