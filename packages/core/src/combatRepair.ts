/**
 * **维修与护盾脉冲**（2026-10-02 从 `combat.ts` 拆出 · 批次 4h · 零行为变化）。
 *
 * 本文件 = 战斗中的**自修复/护盾充能机制**：维修装置每跳实修值、开战预载、按需取件、退还账本、
 * 护盾场/充能脉冲与逐台脉冲件——**零战斗引擎内部依赖**（只依赖 state 类型 / types / combatMath /
 * equipment / inventory / instances / playerSpec / repair）。`combat.ts` 原样再导出（先例：fitted.ts），
 * 既有引用零改动。`REPAIR_PULSE_MS` 随之迁来（combat 借回 + 再导出）。
 */
import type { GameState } from './state'
import type { ModuleDef, SimContext } from './types'
import { isAlive } from './combatMath'
import { allFittedModules, pulseStreamOf, stackWeight } from './equipment'
import { fleetDefOf } from './instances'
import { moduleAllowedOnShip } from './shipFitting'
import { addWare, cargoOfShip, countWare, removeCargoOfShip, removeWare } from './inventory'
import { quickRepairFactor } from './repair'
import { createPlayerSpec } from './playerSpec'
import type { UnitSpec } from './combat'
import { takeWormholeSupply, wormholeSupplyForBattle } from './wormholeSupplies'

/** 船体维修装置脉冲间隔（毫秒；2026-09-09 三档统一 5 秒一跳，见 data/modules.ts mod-hullrep-*） */
export const REPAIR_PULSE_MS = 5_000

/** 2026-10-07 船长确认：每路有效力场脉冲消耗施放者最大护盾的比例。 */
export const SHIELD_FIELD_COST_PCT = 0.1

/* 以下为 2026-10-02 批次 4h 从 combat.ts 切接过来的整簇（layerAmpOf ~ pulseRepairsFor）。 */

/**
 * **该舰的层容量增幅**（装甲/结构各自的「满值 ÷ 档案基础值」）——**2026-09-16 船长「统一吃」**：
 * 维修装置的每跳修复量与修理组件**同一把尺**，都随**额外护甲/结构加成**放大
 * （装备件 `armorHpBonus` / `hullHpBonus` ＋ 技能「船体加固理论」＋ 装甲族「装甲舰操作」）。
 *
 * 与 `shipyard.kitHealFor` 的 `capA/baseA`、`capH/baseH` **完全同源**：都取 `createPlayerSpec`
 * （含装备与技能）÷ 舰船档案值 ⇒ 两条路径的"吃加成"口径不会各写一套。
 * 缺规格/档案（老档坏数据）⇒ 返回 1（不放大、不崩）。
 */
function layerAmpOf(state: GameState, ctx: SimContext, shipId: string): { a: number; h: number } {
  const spec = createPlayerSpec(state, ctx, shipId)
  const def = fleetDefOf(state, ctx, shipId)
  if (!spec || !def) return { a: 1, h: 1 }
  const baseA = def.armorHp ?? 0
  const baseH = def.hullHp ?? 0
  return {
    a: baseA > 0 ? spec.hp.a / baseA : 1,
    h: baseH > 0 ? spec.hp.h / baseH : 1,
  }
}

/** 当前船已装配的维修装置（带 repairArmorHp/repairHullHp 的装配件，按位序） */
export function fittedRepairModules(state: GameState, ctx: SimContext, shipId: string): ModuleDef[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  return allFittedModules(ship.fitted, ctx).filter((d) => (d.repairArmorHp ?? 0) > 0 || (d.repairHullHp ?? 0) > 0)
}

/**
 * **维修装置每跳实修值的唯一算法**（开战预载 `preloadRepairFor` 与界面读数 `repairStatsFor` 共用）。
 *
 * 口径：`每跳 = 装配件值 × 曲线权重(全族第 n 台) × 层容量增幅(a/h) × 恢复量技能`，两条例外见函数内注释。
 * **为什么要抽出来**：这是"显示值与实战值漂移"那个旧坑的正解——两份口径一旦各写一份，
 * 界面迟早与战斗账本对不上（2026-09-29 船长令：修理类装备要显示"实际维修值"）。
 */
function perPulseRepairUnits(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { moduleId: string; kitId: string; free: boolean; armorPerPulse: number; hullPerPulse: number }[] {
  const defs = fittedRepairModules(state, ctx, shipId)
  if (defs.length === 0) return []
  const amp = layerAmpOf(state, ctx, shipId)
  const quickRepair = quickRepairFactor(state, ctx)
  const parts = fittedPulseParts(state, ctx, shipId, 'repair').filter((p) => pulsePartLive('repair', p))
  return defs.map((d, i) => {
    const isFree = d.repairFree === true
    const p = parts[i]
    const w = stackWeight(i + 1) // ← **全族第 n 台**的权重（跨型号同池）
    const decayA = (p?.armorHp ?? d.repairArmorHp ?? 0) * w
    const decayH = (p?.hullHp ?? d.repairHullHp ?? 0) * w
    /**
     * 两条例外：
     * ① `repairFree`（无消耗自愈）**不吃恢复量技能**（技能讲的是用件效率，它不消耗组件）；
     * ② `repairIgnoresCapacityAmp`（只有生体甲壳板）**不吃层容量增幅**（2026-09-17 船长「按平值结算」）。
     */
    const flat = d.repairIgnoresCapacityAmp === true
    const skill = isFree ? 1 : quickRepair
    return {
      moduleId: d.id,
      kitId: isFree ? '' : (d.repairKit ?? 'repairkit-civ'),
      free: isFree,
      armorPerPulse: Math.max(0, Math.round(decayA * skill * (flat ? 1 : amp.a))),
      hullPerPulse: Math.max(0, Math.round(decayH * skill * (flat ? 1 : amp.h))),
    }
  })
}

/**
 * **维修装置装上船之后的每跳实修值**（**2026-09-29 船长令**：「我希望对修理类装备属性进行统一的数值显示……
 * 当装备到船上后，显示实际维修值：每 5 秒修复装甲与结构各 XX（10）点。XX 为加成后的修理值」）。
 *
 * 算法 = `perPulseRepairUnits`（与开战时真正写进战斗账本的那一份**同一份代码**）；
 * 本函数只是把它摊成界面好读的形状（附脉冲间隔）。
 *
 * ⚠ **为什么单开一个导出函数而不在界面里现算**：这条链有"曲线权重 × 层容量增幅 × 恢复量技能 ＋ 两条例外"，
 * 界面自己拼一份必然与引擎漂移。**界面只许调本函数。**
 */
export function repairStatsFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { units: { moduleId: string; armorPerPulse: number; hullPerPulse: number; free: boolean }[]; intervalMs: number } | null {
  const units = perPulseRepairUnits(state, ctx, shipId)
  if (units.length === 0) return null
  return {
    units: units.map(({ moduleId, armorPerPulse, hullPerPulse, free }) => ({ moduleId, armorPerPulse, hullPerPulse, free })),
    intervalMs: REPAIR_PULSE_MS,
  }
}

/**
 * 维修装置开战预载：装配快照 + 组件装载（货舱优先、仓库兜底，单型一次抽足）。
 * 每台预载上限 = 整场最长战斗时间能跳的脉冲数 + 1（多波演出窗口冻结战斗时钟，余量防不足）；
 * 库存不足的装置直接标记停机（组件一枚没有 = 开战即停）。无装置返回 null。
 * 返回结构的 nextPulseAtMs 恒为 undefined——由 startBattleFor 按开战时刻赋值
 * （全部装置停机则保持 undefined = 不调度）。
 */
export function preloadRepairFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  maxBattleMs: number,
): import('./state').BattleState['repair'] | null {
  const defs = fittedRepairModules(state, ctx, shipId)
  if (defs.length === 0) return null
  const units: import('./state').BattleRepairUnit[] = []
  const need = new Map<string, number>()
  const perUnit = Math.max(1, Math.ceil(maxBattleMs / REPAIR_PULSE_MS)) + 1
  /**
   * ⚠ **2026-09-29 改：每跳值不再由本函数计算**——统一走 `perPulseRepairUnits`
   * （**船长令**「修理类装备……当装备到船上后，显示实际维修值」⇒ 界面读数与战斗账本必须**同一份算法**，
   * 否则就是"显示值与实战值漂移"那个旧坑）。
   *
   * 该助手内含本处原先的四项口径（**全族第 n 台**的曲线权重 · **层容量增幅** a/h · **恢复量技能** ·
   * 无消耗自愈与 `repairIgnoresCapacityAmp` 两条例外），逐条注释随它搬走了。
   * 本函数此后只负责**组件账**：`perUnit` 的预留口径保留给老档在途战斗（见下方注释）。
   */
  for (const u of perPulseRepairUnits(state, ctx, shipId)) {
    if (!u.free) need.set(u.kitId, (need.get(u.kitId) ?? 0) + perUnit)
    units.push({
      moduleId: u.moduleId,
      kitId: u.kitId,
      free: u.free,
      armorPerPulse: u.armorPerPulse,
      hullPerPulse: u.hullPerPulse,
      stopped: false,
    })
  }
  /**
   * **不再预载**（**2026-09-23 船长令**：「做一个开关，开启时，所有船的弹药和修理组件直接从仓库取用。
   * 关闭后只从舰队内舰船的货仓取用。」）——旧口径在开战时把"**整场窗口的用量**"从共享池**预留**到
   * 各舰账本上（`perUnit = ⌈最长战斗时长 ÷ 5 秒⌉ + 1`），四舰按编队顺序取 ⇒ **排在最后的船一枚都拿不到、
   * 开战即永久停机**（玩家报障根因；只读探针实测 121 + 242 + 80 + 0 = 443 把仓库清零）。
   * 现改为**每跳按需取用**（见 `pulseRepairsFor`），账本只留"本场消耗了几枚"的报账口径
   * ⇒ 共享池不再被顺序吃干。
   * ⚠ **老档在途战斗零迁移**：账本里已预载的 `kits` 非空 ⇒ `pulseRepairsFor` 走旧口径（用光即停机）、
   * 战后 `refundRepairKits` 也只对那份账本生效（新账本 `kits` 为空 ⇒ 退还循环自然空转）。
   */
  void need
  void perUnit
  return { units, kits: {}, nextPulseAtMs: undefined, pulses: 0, kitsUsed: 0 }
}

/**
 * **这套装置此刻能用到的组件数**（只读 · 界面读数用）——与 `pulseRepairsFor` 的取用口径**同源**：
 * 开（缺省）= **母港仓库**；关 = **该舰自己的货仓**（与"按需取用"那一跳实际会扣的池一致）。
 *
 * ⚠ **2026-09-24 玩家报障**（船长转述：「进入战斗后维修组件显示为 0，仓库已经确认还有 400 多个
 * 军用维修组件」）：改按需取用后账本 `kits` **不再预载** ⇒ 战斗页徽标读 `ledger.kits` 恒得 0。
 * 读数改走本函数 ⇒ 显示的是"还能用多少"，与实际消耗同源。
 */
export function repairKitAvailableOf(state: GameState, shipId: string, kitId: string): number {
  const run = state.wormhole.run
  if (run?.supplyVersion === 1 && run.fleet.includes(shipId)) return run.supplies?.items[kitId] ?? 0
  return state.resupplyFromWarehouse !== false
    ? countWare(state, kitId)
    : Math.floor(cargoOfShip(state, shipId)[kitId] ?? 0)
}

/** 退还维修装置预载的未用组件（回仓库；与弹药退还同哲学）——战斗结束/撤退收场调用；幂等 */
export function refundRepairKits(
  state: GameState,
  repair: import('./state').BattleRepairLedger | null | undefined,
): void {
  if (!repair || !repair.kits || Object.isFrozen(repair.kits)) return
  for (const [id, n] of Object.entries(repair.kits)) {
    if (n > 0) addWare(state, id, Math.floor(n))
  }
  repair.kits = {}
}

/**
 * **本场所有舰的维修账本**（2026-09-16 逐舰维修的**唯一读取入口**）。
 *
 * - 有 `repairBy`（多舰战斗、本批之后开的场）⇒ 逐舰遍历；
 * - 只有 `repair`（单船路径，或**本批之前开的在途战斗**）⇒ 视为"只有主控那一份"（旧行为，零迁移）。
 */
export function repairLedgersOf(
  battle:
    | { repair?: import('./state').BattleRepairLedger; repairBy?: Record<string, import('./state').BattleRepairLedger> }
    | null
    | undefined,
): Array<{ tag: string; ledger: import('./state').BattleRepairLedger }> {
  if (!battle) return []
  if (battle.repairBy) return Object.entries(battle.repairBy).map(([tag, ledger]) => ({ tag, ledger }))
  return battle.repair ? [{ tag: 'player', ledger: battle.repair }] : []
}

/** 同上，护盾充能账本（口径与 `repairLedgersOf` 完全一致） */
export function shieldChargeLedgersOf(
  battle:
    | {
        shieldCharge?: import('./state').BattleShieldChargeLedger
        shieldChargeBy?: Record<string, import('./state').BattleShieldChargeLedger>
      }
    | null
    | undefined,
): Array<{ tag: string; ledger: import('./state').BattleShieldChargeLedger }> {
  if (!battle) return []
  if (battle.shieldChargeBy) return Object.entries(battle.shieldChargeBy).map(([tag, ledger]) => ({ tag, ledger }))
  return battle.shieldCharge ? [{ tag: 'player', ledger: battle.shieldCharge }] : []
}

/**
 * **退还一场战斗里所有舰的未用组件**（逐舰维修：收场方只认这一个入口）。
 * 单船路径/老档在途战斗退化成"只退主控那一份"= 旧行为。
 */
export function refundRepairKitsAll(
  state: GameState,
  battle:
    | { repair?: import('./state').BattleRepairLedger; repairBy?: Record<string, import('./state').BattleRepairLedger> }
    | null
    | undefined,
): void {
  for (const { ledger } of repairLedgersOf(battle)) refundRepairKits(state, ledger)
}

/**
 * **战后总结里的"修理组件消耗"文案**（2026-09-11 船长：「船体修理装置不单独显示日志。
 * 只将消耗组件数量显示到战后总结」）：本场一枚没耗 = `''`（战报不添尾巴），否则形如
 * `消耗 军用修理组件 ×12`（多型按「、」连接）。战报四处（远征胜/败、遭遇战、AI 副船）共用本函数。
 */
export function repairUsageText(
  battle:
    | { repair?: import('./state').BattleRepairLedger; repairBy?: Record<string, import('./state').BattleRepairLedger> }
    | null
    | undefined,
  ctx: SimContext,
): string {
  // 2026-09-16 逐舰维修：多舰战斗要把**各舰账本合计**（旧口径只读主控那份 ⇒ 僚舰的消耗不进战报）
  let total = 0
  const byType: Record<string, number> = {}
  for (const { ledger: r } of repairLedgersOf(battle)) {
    total += Math.max(0, Math.floor(r.kitsUsed ?? 0))
    for (const [id, n] of Object.entries(r.kitsUsedByType ?? {})) {
      if (n > 0) byType[id] = (byType[id] ?? 0) + n
    }
  }
  if (total <= 0) return ''
  const parts = Object.entries(byType)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} ×${n.toLocaleString('zh-CN')}`)
  if (parts.length === 0) return `消耗修理组件 ×${total.toLocaleString('zh-CN')}`
  return `消耗 ${parts.join('、')}`
}

/**
 * **护盾充能装置的脉冲间隔**（2026-09-14 船长：「护盾充能装置，和船体修理装置类似。
 *  **每 30 秒**恢复自身护盾最大值一定比例的护盾量。CPU消耗较多」）。
 *
 * 与 `REPAIR_PULSE_MS`（维修装置 5 秒）是**两套独立计时**：两者可以同装、各按各的节奏跳。
 * ⚠ 界面/说明里的「每 30 秒」与它同源（`content:check` 的「产物说明契约」按语境常量核）。
 */
export const SHIELD_PULSE_MS = 15_000

/**
 * **护盾被动回充的速率下限**（2026-09-20 船长：「**舰船护盾的恢复速度下限改为1%。但是当护盾被击穿时，依旧是0%**」；
 * 追问口径后补：「**满盾依旧是2%，当盾量接近0的时候是1%**」）。
 *
 * 口径：**下限 = 该舰满盾的 1% / 秒**（`0.01`）——被动回充取
 * `max(当前盾 × shieldRegenPerSec, 满盾 × 本值)`：
 * - 满盾时 `100% × 2% = 2%`（与船长原话的"满盾依旧 2%"一致，下限不介入）；
 * - 盾降到 **50%** 时两条线相交（`50%×2% = 1% = 下限`），**再低就由下限接管**；
 * - 盾 = **0** ⇒ 仍是 **0**（"破盾后 0 回复"那条裁定不变，`stepBattle` 里先 `continue` 掉了）。
 *
 * 为什么要有它：指数式回充的副作用是**盾越少回得越慢**（剩 2% 时每秒只回 0.04%
 * ⇒ 从 2% 回到半盾要 **19.6 分钟**）——等于"被打残后这场的盾就废了"。加下限后低盾段
 * 回充量不再继续缩水（同样这条路变成 **44 秒**）。
 */
export const SHIELD_REGEN_FLOOR_PCT = 0.01

/**
 * **装配单点：三类"按周期脉冲"装置的原始件序**（**未折减**；每个型号一路，装配序 = 第 n 件）。
 *
 * 口径（**2026-09-21 船长两条令的合成**）：
 * - **衰减池 = 全族**（第一条令：「护盾充能立场不是多件衰减吗」⇒「同族合并计数」）⇒
 *   **计数在"全族第 n 件"上**（装配序），换型号不能绕开衰减；
 * - **冷却 = 逐型号**（第二条令：「哪怕同类型装备，只要是不同型号，就要独立的回转冷却」）⇒
 *   每个 `ModuleDef.id` **一路**，各带自己的 `ms` 与 `nextPulseAtMs`。
 *
 * ⚠ **为什么"未折减"的原始值单独出一层**：折减要按**第 n 件的位次**逐件乘，而**同型号多件位次不同**
 * （三台 MK2 = 1 / 0.869 / 0.571）。第一版我把折减塞进"按 `modelId` 建映射"里 ⇒ **同型号互相覆盖**
 * （三台都拿到第 3 件的权重 0.571，白掉一大截）。现在折减一律在**按序展开**的那一层做，
 * 两个消费者（`preloadRepairFor` / 两族的 streams 访问器）都从这里取。
 */
function fittedPulseParts(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  kind: 'shield-field' | 'shield-charge' | 'repair',
): Array<{ modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }> {
  const ship = state.fleet[shipId]
  if (!ship) return []
  const out: Array<{ modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }> = []
  for (const d of allFittedModules(ship.fitted, ctx)) {
    if (!moduleAllowedOnShip(fleetDefOf(state, ctx, shipId), d)) continue
    const st = pulseStreamOf(d)
    if (!st || st.kind !== kind) continue
    if (kind === 'shield-field') {
      out.push({
        modelId: d.id,
        pct: d.shieldFieldPct ?? 0,
        ms: Math.max(1, d.shieldFieldMs ?? SHIELD_PULSE_MS),
        armorHp: 0,
        hullHp: 0,
      })
    } else if (kind === 'shield-charge') {
      // 本族暂无"逐型号间隔"的件 ⇒ 三档一律 30 秒（日后某档要错开，加个字段即可，本层与调度都不用动）
      out.push({ modelId: d.id, pct: d.shieldPulsePct ?? 0, ms: SHIELD_PULSE_MS, armorHp: 0, hullHp: 0 })
    } else {
      // 维修：间隔由本族常量定（`REPAIR_PULSE_MS` 5 秒），逐台独立计时在 `BattleRepairUnit.nextPulseAtMs`
      out.push({
        modelId: d.id,
        pct: 0,
        ms: REPAIR_PULSE_MS,
        armorHp: d.repairArmorHp ?? 0,
        hullHp: d.repairHullHp ?? 0,
      })
    }
  }
  return out
}

/** 该件是否落在有效范围内（比例为 0 的脉冲件 / 值为 0 的维修件 ⇒ 不参战，也不占衰减位次） */
function pulsePartLive(kind: 'shield-field' | 'shield-charge' | 'repair', p: { pct: number; armorHp: number; hullHp: number }): boolean {
  return kind === 'repair' ? p.armorHp > 0 || p.hullHp > 0 : p.pct > 0
}

/**
 * **逐型号脉冲流（已按全族曲线折减）**——按**装配序**取"全族第 n 件"的权重，再**按型号合并成一路**。
 *
 * 两条粒度必须分清（船长 2026-09-21 两条令）：
 * - **衰减**按**全族位次**（第 n 件 ⇒ `stackWeight(n)`）——同型号三台拿的是 1 / 0.869 / 0.571；
 * - **一路**按**型号**——同型号多台**只有一路计时器**（同一型号就是同一路冷却），那一路的每跳值 =
 *   该型号各台折减值之和（三台 MK2 = `pct×(1+0.869+0.571) = pct×2.44`）。
 *
 * ⚠ 第一版我在这里**按 `modelId` 建映射**取权重 ⇒ 同型号三台互相覆盖、全拿第 3 件的权重（白掉一大截）。
 * 现在权重一律**按装配序的下标**取，映射只用于"合并成一路"。
 */
function pulseStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  kind: 'shield-field' | 'shield-charge' | 'repair',
): Array<{ modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }> {
  const parts = fittedPulseParts(state, ctx, shipId, kind).filter((p) => pulsePartLive(kind, p))
  const byModel = new Map<string, { modelId: string; pct: number; ms: number; armorHp: number; hullHp: number }>()
  parts.forEach((p, i) => {
    const w = stackWeight(i + 1) // ← **全族第 n 件**（衰减按族）
    const hit = byModel.get(p.modelId)
    if (hit) {
      // 同型号再来一台：**并入同一路**（比例/修复量相加，冷却仍是这一路自己的）
      hit.pct += p.pct * w
      hit.armorHp += p.armorHp * w
      hit.hullHp += p.hullHp * w
    } else {
      byModel.set(p.modelId, {
        modelId: p.modelId,
        pct: p.pct * w,
        ms: p.ms,
        armorHp: p.armorHp * w,
        hullHp: p.hullHp * w,
      })
    }
  })
  return [...byModel.values()]
}

/** 「船体维修装置 / 生体自愈件」的逐型号脉冲流（装配单点；**已按全族曲线折减**，间隔 = 5 秒） */
export function repairStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): Array<{ modelId: string; ms: number; armorHp: number; hullHp: number }> {
  return pulseStreamsOf(state, ctx, shipId, 'repair')
}

/**
 * 装配里「护盾充能装置」的**每跳合计比例**（满盾的几分之几；**全族**多件按 EVE 曲线收敛，无装置 = 0）。
 * ⚠ 这只是"合计值"读数（解析预估等用）；**逐型号怎么跳**看 `shieldChargeStreamsOf`。
 */
export function shieldPulsePctOf(state: GameState, ctx: SimContext, shipId: string): number {
  return shieldChargeStreamsOf(state, ctx, shipId).reduce((n, s) => n + s.pct, 0)
}

/** 「护盾充能装置」的逐型号脉冲流（装配单点；空数组 = 没装该族件） */
export function shieldChargeStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): Array<{ modelId: string; pct: number; ms: number }> {
  return pulseStreamsOf(state, ctx, shipId, 'shield-charge')
}

/**
 * 护盾充能装置开战快照：逐型号脉冲流（`startBattleFor` 按开战时刻给每路排首跳）。
 * 无装置返回 `null`（零行为变化：不写 `battle.shieldCharge`）。
 */
export function preloadShieldChargeFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): import('./state').BattleState['shieldCharge'] | null {
  const streams = shieldChargeStreamsOf(state, ctx, shipId)
  if (streams.length === 0) return null
  // `nextPulseAtMs` 恒为 undefined——由 `startBattleFor` 按开战时刻赋值（与维修装置同款）
  return { streams: streams.map((s) => ({ modelId: s.modelId, pct: s.pct, ms: s.ms })), pulses: 0 }
}

/* ══════════════ 护盾充能力场装置（2026-09-20 船长；高槽 · 护盾族）══════════════
   船长原话：「**新增高槽装备，护盾充能力场装置 MK2，为所有我方舰船恢复 10% 护盾，
   冷却时间 10 秒，MK3 的冷却时间缩短至 8 秒。有叠加惩罚**」＋ 追问三答：
   ① **叠加惩罚 = 同舰多件才算**（多艘船各带一件 ⇒ 各自独立、可叠加）
   ② **10% 的量按装件舰（施放者）的满盾算** —— ⚠ **本条 2026-09-25 由船长澄清**：
      原记作「按携带者自己的满盾」，因"携带者"指装件舰还是受益舰有歧义，
      曾被补注成"每艘被治疗的船按它自己那本账"并据此落码（见 `pulseShieldFieldFor` 头注的作废说明）。 */
/**
 * **力场的每跳合计比例 ＋ 最短间隔**（读数入口；**逐型号怎么跳**看 `shieldFieldStreamsOf`）。
 *
 * ⚠ 2026-09-21 起 `ms` 只是"最短那一档"的**读数**（解析预估/界面显示用），**不再是调度口径** ——
 * 调度已改为逐型号多路（船长「不同型号就要独立的回转冷却」）。无该族件 ⇒ `{ pct: 0, ms: 0 }`。
 */
export function shieldFieldOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { pct: number; ms: number } {
  const streams = shieldFieldStreamsOf(state, ctx, shipId)
  if (streams.length === 0) return { pct: 0, ms: 0 }
  return {
    pct: streams.reduce((n, s) => n + s.pct, 0),
    ms: Math.min(...streams.map((s) => s.ms)),
  }
}

/** 力场的逐型号脉冲流（装配单点；**已按全族曲线折减**，间隔按件自带 10 秒 / 8 秒） */
export function shieldFieldStreamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): Array<{ modelId: string; pct: number; ms: number }> {
  return pulseStreamsOf(state, ctx, shipId, 'shield-field')
}

/** 力场开战快照（**逐型号多路**，各带自己的间隔与计时器）；无该族件返回 `null` */
export function preloadShieldFieldFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): import('./state').BattleShieldFieldLedger | null {
  const streams = shieldFieldStreamsOf(state, ctx, shipId)
  if (streams.length === 0) return null
  // `nextPulseAtMs` 恒为 undefined——由 `startBattleFor` 按开战时刻给**每一路**排首跳
  return { streams: streams.map((s) => ({ modelId: s.modelId, pct: s.pct, ms: s.ms })), pulses: 0 }
}

/**
 * 每路恢复量 = 施放者满盾 × 本路比例（2026-09-25 船长确认），受益舰各自封顶。
 * 2026-10-07 改判：排除自身；有缺盾存活队友且足够支付时，直接扣一次满盾代价再恢复。
 * 不足或无目标不发动，原周期排程仍由调用方推进；费用不按目标数或叠加权重放大。
 */
export function pulseShieldFieldFor(
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
  stream: { pct: number },
  /** **本路的施放者**（装力场的那艘船）——本跳的绝对量 = 它的满盾 × `stream.pct` */
  caster: UnitSpec,
): void {
  const gain = Math.max(0, stream.pct)
  if (!Number.isFinite(gain) || gain <= 0 || b.ended !== null || !isAlive(b, caster.tag)) return
  // 施放者满盾：容量优先、缺 `hpMax` 才回落规格（与全仓「满血/上限」读法同一把尺）
  const casterRt = b.units[caster.tag]
  const casterCapS = Math.max(0, casterRt?.hpMax?.s ?? caster.hp.s)
  const amount = casterCapS * gain
  const cost = casterCapS * SHIELD_FIELD_COST_PCT
  if (!casterRt || !Number.isFinite(amount) || amount <= 0 || casterRt.hp.s < cost) return
  const targets: Array<{ rt: (typeof b.units)[string]; capS: number }> = []
  for (const u of myUnits) {
    if (u.tag === caster.tag) continue
    const rt = b.units[u.tag]
    if (!rt || !isAlive(b, u.tag)) continue
    const capS = Math.max(0, rt.hpMax?.s ?? u.hp.s)
    if (capS <= 0 || rt.hp.s >= capS) continue
    targets.push({ rt, capS })
  }
  if (targets.length === 0) return
  casterRt.hp.s = Math.max(0, casterRt.hp.s - cost)
  for (const { rt, capS } of targets) {
    rt.hp.s = Math.min(capS, rt.hp.s + amount)
  }
}

/**
 * **单次护盾充能脉冲（逐舰）**：按**该舰满盾 × 每跳比例**补**它自己**的护盾层（夹在满盾）。
 *
 * 2026-09-16 船长裁定「甲：逐舰维修」——护盾充能装置与维修装置**同批逐舰化**
 * （此前只有主控那一份，僚舰装了也白装，与"船体维修装置在洞里无效"同一根因）。
 *
 * 它是**破盾后唯一的回头路**：被动回充按当前盾比例（盾 0 = 回充 0），只有这里能从 0 把盾点起来；
 * 点着之后被动回充立刻接管（指数增长）。
 */
export function pulseShieldChargeFor(
  b: import('./state').BattleState,
  spec: UnitSpec,
  sc: import('./state').BattleShieldChargeLedger,
  /** 本跳生效的**那一路**（逐型号独立回转；缺省 = 旧口径的"合计一路"，只为外部老读法兼容） */
  stream?: { pct: number },
): void {
  const rt = b.units[spec.tag]
  if (!rt) return
  if (!isAlive(b, spec.tag)) return
  const capS = Math.max(0, spec.hp.s)
  if (capS <= 0) return
  const pct = stream ? stream.pct : sc.streams.reduce((n, s) => n + s.pct, 0)
  const gain = capS * Math.max(0, pct)
  if (gain > 0) rt.hp.s = Math.min(capS, rt.hp.s + gain)
}

/**
 * @deprecated 逐舰化之前的入口（只作用于主控）；保留仅为**老用例/外部读法**兼容，
 * 生产路径请用 `pulseShieldChargeFor`（逐舰）＋ `shieldChargeLedgersOf`。等价于"只给主控跳一次"。
 */
export function pulseShieldCharge(b: import('./state').BattleState, me: UnitSpec): void {
  const sc = b.shieldCharge
  if (!sc) return
  pulseShieldChargeFor(b, { ...me, tag: 'player' }, sc)
}

/**
 * **单次维修脉冲（逐舰 · 2026-09-16 船长「甲」）**：对**指定那艘船**的账本跑一跳——
 * 逐台未停机装置修复它自己的装甲/结构：每层通道修复量 = 该层额度，某层已满（或补满）后，该层
 * 剩余额度转投另一层（单跳修复上限 = 甲 + 结构额度之和，痊愈后不再消耗）；每台实际修复 > 0 才扣
 * 1 枚对应组件并计入消耗；组件耗尽该台停机（日志一次，见 2026-09-11 船长口径）。修复上限 =
 * **该舰出场满值口径**（`advanceBattleFor` 重建的规格，与保险检查同源——可把入场残值修回满血）。
 *
 * ⚠ **2026-09-16 船长新增「后勤舰」特性**（`ship.subClass === '后勤舰'` ⇒ `spec.logistics`）：
 * **这一跳改修"三层剩余比例最低的队友"**（含自己）——`allySpecs` 是本场我方全部单位（tag → spec，
 * 由调用方传入；缺省 = 只有自己 ⇒ 与旧行为逐字一致）。细则：
 * - **候选判据** = `(s+a+h) ÷ 满值三层合计` 最低者；并列取**传入顺序靠前**者（= 编队顺序）；
 * - **排除"甲+结构 都满"的单位**（装置修不了护盾：把它们排除掉，避免"选了盾伤满甲的同袍 ⇒ 白跳"）；
 *   若所有候选都不可修 ⇒ 本跳空转（**不耗组件**，与"痊愈空转"同口径）；
 * - 修复上限取**被修那艘**的出场满值（`allySpecs` 里那一份），不是后勤舰自己的；
 * - **只换目标、不改量**（船长 2026-09-16 三问三答之「甲」）。
 *
 * ⚠ **2026-09-19 报障修复**（船长转述玩家：「**生物损管腔之类的修理会让已经损毁的船复活**」）：
 * **阵亡（三层全 0）的单位不可被任何维修路径修回来**——两条都堵：
 * - **本舰阵亡 ⇒ 整台装置停机**（`nextPulseAtMs = undefined`，尸体不会回到场上，无需再排程）；
 * - **后勤舰选靶跳过尸体**：尸体的"剩余比例"恒为 0 ⇒ 旧口径下**每一跳都必然首选尸体**，
 *   既修活了它、又让活着的重伤队友拿不到这一跳。
 * 判据 = `isAlive`，与被动护盾回充 / 护盾充能脉冲 / 结束判定**同一把尺**（那三处本来就查存活）。
 * （2026-10-02 批次 4h：因 combat 的 advanceBattleFor 仍要调用而转公开，不进 combat 公开面）
 */
export function pulseRepairsFor(
  state: GameState,
  ctx: SimContext,
  b: import('./state').BattleState,
  spec: UnitSpec,
  r: import('./state').BattleRepairLedger,
  allySpecs?: ReadonlyMap<string, UnitSpec>,
  /**
   * **本跳只结算这一台装置**（**2026-09-21 船长令：逐型号独立回转**）。
   * 缺省 = `r.units` 里第一台未停机的（老调用方/外部读法兼容）。
   */
  only?: import('./state').BattleRepairUnit,
): boolean {
  void ctx
  const meRt = b.units[spec.tag]
  if (!meRt) return false
  if (!isAlive(b, spec.tag)) {
    // 阵亡 = 永久停机（2026-09-19 报障修复：尸体不可复活）；逐台计时器一并清掉
    r.nextPulseAtMs = undefined
    for (const u of r.units) u.nextPulseAtMs = undefined
    return false
  }
  /**
   * **修谁**：后勤舰 ⇒ 三层剩余比例最低的**可修**队友（含自己）；其余舰 ⇒ 自己（旧口径）。
   * ⚠ 只换 `spec`/`hp` 两处来源，下面每台装置的额度分配逻辑**一字未动**。
   */
  let targetSpec: UnitSpec = spec
  let targetRt = meRt
  if (spec.logistics && allySpecs && allySpecs.size > 1) {
    let bestKey: string | undefined
    let bestRatio = Number.POSITIVE_INFINITY
    for (const [tag, s] of allySpecs) {
      const rt = b.units[tag]
      if (!rt) continue // 已不在场（沉了/被摘）
      if (!isAlive(b, tag)) continue // 阵亡队友不修（2026-09-19 报障修复：尸体不可复活）
      const capA0 = Math.max(0, s.hp.a)
      const capH0 = Math.max(0, s.hp.h)
      if (rt.hp.a >= capA0 && rt.hp.h >= capH0) continue // 甲+结构 都满 ⇒ 装置无事可做
      const capAll = capA0 + capH0 + Math.max(0, s.hp.s)
      const ratio = capAll > 0 ? (rt.hp.s + rt.hp.a + rt.hp.h) / capAll : 1
      if (ratio < bestRatio) {
        bestRatio = ratio
        bestKey = tag
      }
    }
    const pickedSpec = bestKey !== undefined ? allySpecs.get(bestKey) : undefined
    const pickedRt = bestKey !== undefined ? b.units[bestKey] : undefined
    if (pickedSpec && pickedRt) {
      targetSpec = pickedSpec
      targetRt = pickedRt
    } else {
      return true // 全场都修不动（都满血）⇒ 空转：不耗组件、不动计时器之外任何账（本舰也没死）
    }
  }
  /**
   * **维修上限 = 容量（不是入场残值）** —— **2026-09-23 玩家报障修复**。
   *
   * 报障形状（船长转述 + 存档实测 `save-20260923-214317`）：鹦鹉螺级**进战斗时装甲为 0**
   * （`armorPct = 0`，装着 `mod-hullrep-2`、仓库 `repairkit-mil ×443` 充足），可它就是**不回甲**。
   *
   * 根因：上限原先取 `targetSpec.hp`——洞内编队那份 spec 带的是**存档里的残值**（甲 0），
   * 于是 `da = capA - hp.a = 0` ⇒ **甲层被当成"已满"** ⇒ 装置只可能补结构，甲永远停在 0；
   * 若结构也满则整台**空转**（`ag <= 0 && hg <= 0 ⇒ continue`，连组件都不烧）——
   * 玩家看到的正是"不消耗组件、也不回血"。
   *
   * 设计原话（2026-09-09 船体维修装置首版）是「**上限 = 出场满值（入场残值可修回）**」⇒
   * 上限必须取**容量**：运行时单位上的 `hpMax` 优先，缺它才回落 `spec.hp`
   * （无 `hpMax` 的老调用方/单元测试 ⇒ **零行为变化**）。
   */
  const capA = Math.max(0, targetRt.hpMax?.a ?? targetSpec.hp.a)
  const capH = Math.max(0, targetRt.hpMax?.h ?? targetSpec.hp.h)
  const hp = targetRt.hp
  /**
   * **本跳结算哪一台**（2026-09-21 逐型号独立回转）：
   * - 传了 `only`（生产路径）⇒ 只跑那一台；
   * - 没传（老调用方）⇒ 逐台都跑一遍（等价改前"一跳结算全部装置"）。
   */
  const units = only ? [only] : r.units
  for (const u of units) {
    if (u.stopped) continue
    // 无消耗自愈件（repairFree）：不看组件余额、不扣组件、永不停机
    if (u.free) {
      const da0 = Math.max(0, capA - hp.a)
      const dh0 = Math.max(0, capH - hp.h)
      let ag0 = Math.min(u.armorPerPulse, da0)
      let hg0 = Math.min(u.hullPerPulse, dh0)
      if (ag0 < u.armorPerPulse && hg0 < dh0) hg0 += Math.min(u.armorPerPulse - ag0, dh0 - hg0)
      if (hg0 < u.hullPerPulse && ag0 < da0) ag0 += Math.min(u.hullPerPulse - hg0, da0 - ag0)
      if (ag0 <= 0 && hg0 <= 0) continue
      hp.a += ag0
      hp.h += hg0
      continue
    }
    /**
     * **组件从哪来**（**2026-09-23 船长令**：「做一个开关，开启时，所有船的弹药和修理组件直接从仓库
     * 取用。关闭后只从舰队内舰船的货仓取用。」）：
     * - **旧账本**（在途战斗：`kits` 非空 = 开战预载留下的）⇒ 照旧扣预载余额、用光即停机（**零迁移**）；
     * - **新账本**（`kits` 为空）⇒ **每跳现取 1 枚**：开 = 母港仓库；关 = **该舰自己的**货仓；
     *   取不到 ⇒ **本跳跳过**（不永久停机——下一跳料来了就继续修）。
     *   这条同时修掉"四舰按编队顺序把共享仓库预留吃干、最后一艘 0 枚开战即停机"那个报障。
     */
    const legacyLedger = Object.keys(r.kits).length > 0
    const preloadLeft = r.kits[u.kitId] ?? 0
    if (legacyLedger && preloadLeft <= 0) {
      // 旧口径：预载余额用光 ⇒ 本台停机（老档在途战斗逐字保持改前行为）
      u.stopped = true
      u.nextPulseAtMs = undefined
      continue
    }
    // 额度分配：各层先按自身额度补缺口，层满后剩余额度转投另一层（总上限 = 甲 + 结构额度）
    const da = Math.max(0, capA - hp.a)
    const dh = Math.max(0, capH - hp.h)
    let ag = Math.min(u.armorPerPulse, da)
    let hg = Math.min(u.hullPerPulse, dh)
    if (ag < u.armorPerPulse && hg < dh) hg += Math.min(u.armorPerPulse - ag, dh - hg) // 甲通道剩余 → 结构
    if (hg < u.hullPerPulse && ag < da) ag += Math.min(u.hullPerPulse - hg, da - ag) // 结构通道剩余 → 甲
    if (ag <= 0 && hg <= 0) continue // 痊愈空转：不耗组件
    if (!legacyLedger) {
      // **按需取用**：这一跳真要修 ⇒ 现取 1 枚；取不到就跳过本跳（不是永久停机）
      // ⚠ 单船战斗路径没有 `myFleet` 条目 ⇒ 回落到驾驶船（与弹药口径 `cargoItemsOf` 同源）
      const shipUid = b.myFleet?.find((en) => en.tag === spec.tag)?.shipId ?? state.shipId
      const supply = wormholeSupplyForBattle(state, b)
      const ok =
        supply ? takeWormholeSupply(supply, u.kitId, 1) === 1 : state.resupplyFromWarehouse !== false
          ? countWare(state, u.kitId) > 0 && (removeWare(state, u.kitId, 1), true)
          : shipUid !== undefined && removeCargoOfShip(state, shipUid, u.kitId, 1) > 0
      if (!ok) continue
    }
    hp.a += ag
    hp.h += hg
    if (legacyLedger) r.kits[u.kitId] = preloadLeft - 1
    r.kitsUsed += 1
    // 逐型记账（战报文案用：2026-09-11 船长「只将消耗组件数量显示到战后总结」）
    r.kitsUsedByType = { ...(r.kitsUsedByType ?? {}) }
    r.kitsUsedByType[u.kitId] = (r.kitsUsedByType[u.kitId] ?? 0) + 1
  }
  r.pulses += 1
  /**
   * "还有没有活着的装置"必须在**本跳结算之后**重数（本跳可能刚好把最后一台判停）——
   * 改前我数的是进入本函数时的快照，于是最后一台停机的**那一跳之后**账本还留着计时器，
   * 会多空转一拍（用例 `组件耗尽自动停机` 抓到：`nextPulseAtMs` 该是 undefined 却还有值）。
   */
  const stillActive = r.units.some((u) => !u.stopped)
  /**
   * 账本上那一个 `nextPulseAtMs` 是**旧档口径的读数**（"最近一台的首跳"）。逐台计时上线后它不再
   * 驱动调度（调度走 `units[].nextPulseAtMs`），这里只为兼容旧档迁移与外部读法把它一并前移。
   */
  if (!stillActive) r.nextPulseAtMs = undefined // 全部停机：停调度
  else if (r.nextPulseAtMs !== undefined) r.nextPulseAtMs += REPAIR_PULSE_MS
  return true
}
