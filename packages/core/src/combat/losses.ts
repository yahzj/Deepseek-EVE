/** 战斗域：losses，从原引擎按职责迁移，保持结算顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { createPlayerSpec } from './player/create'
import { DRONE_SKILL, droneSkillLv } from './player/factors'
import { plugModulesOf } from '../plugs'
import { wormholeSupplyForBattle, settleWormholeDroneRevives, returnWormholeDroneSupply, deployWormholeSupply } from '../wormholeSupplies'
import { droneRevivedOf, droneRevivedCount } from '../droneRevive'
import { ceilFinalQuantity } from '../quantity'
import { refillDroneLoadTo, takeDroneUnit } from '../equipment'
import { shipDisplayName } from '../instances'

/**
 * P0 承伤持久化：把装甲/结构残余写回船（结构 = 耐久合并属性；护盾不保留）。
 * cap 用该船当前满值（技能/装配同源 createPlayerSpec）——换装后残余按新上限比例折算。
 * 调用方在战斗结束（或手动撤退收场）后、其余结算（失利附加扣损等）之前调用；
 * battle.ended 为空也允许（撤退时记录当前残余）。
 */
export function persistFleetHullDamage(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('../state').BattleState | null,
): void {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return
  // 多单位（虫洞 D 批）：按 `myFleet` 查本船在这场战斗里的 tag（单船路径 = 恒 'player'）
  const tag = battle?.myFleet?.find((e) => e.shipId === shipId)?.tag ?? 'player'
  const unit = battle?.units[tag]
  if (!unit) return
  const cap = createPlayerSpec(state, ctx, shipId)
  if (!cap) return
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  const originalArmor = cap.hp.a - (cap.shieldArmorHp ?? 0)
  // 临时镀膜先承伤；不能将尚存临时甲回写为原甲修复。
  const originalAtStart = Math.ceil(originalArmor * clamp01(fleetShip.armorPct ?? 1))
  const remainingArmor = unit.hp.coating?.armor ?? (cap.shieldArmorHp !== undefined ? Math.min(unit.hp.a, originalAtStart) : unit.hp.a)
  fleetShip.armorPct = originalArmor > 0 ? clamp01(remainingArmor / originalArmor) : 1
  fleetShip.durability = cap.hp.h > 0 ? clamp01(unit.hp.h / cap.hp.h) : 0
}

/**
 * 机群战损结算（2026-09-10 船长拍板「无人机可被击落」+ **永久损失制**；
 * 2026-09-11 船长：「当回收损坏的无人机时，**优先回收高价值的**」）：
 * 把本场被点防击落的架数从该船无人机舱清单里**永久扣除**（清单是"带上船的那批"，
 * 本就不在仓库里——扣清单即真实损失），并写事件日志 + 一次性提示（渲染层读到弹 toast）。
 * 胜负/撤退都照扣（打掉的飞机不会因为撤退飞回来）；在 resolveBattleOutcome 等结算入口调用，
 * 且必须在其它结算之前（战报文案要用损失摘要）。
 *
 * **回收分配（2026-09-11 起）**：总回收架数仍 = round(总损坏 × 回收率)（**回收率数值不动**），
 * 但名额的分配改为**优先高价值**：
 *   ①每型先取 floor(损坏数 × 回收率)；
 *   ②余数名额按**机型基准价从高到低**依次补满（某型补到"损坏数"就换下一型）。
 * 排序读 `ctx.items` 的 `baseSellPriceIsk`（不写死顺序，日后调价自动跟随；同价按 id 稳定排序）。
 * 返回损失摘要文案（无损失 = null）。
 */
export function settleDroneLosses(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('../state').BattleState | null,
  /** **回收率加成**（谜质「机群回收网」· F3c B2）：按百分点加在既有回收率上，并夹在 100% 以内。缺省 0 = 既有行为。 */
  recoveryBonus = 0,
  /**
   * **战损归属**（船长 2026-09-14「按舰归属」）：结算哪条舰的机群——键进 `battle.droneLostBy`。
   * 缺省 `'player'`（主控）= 旧口径；老档没有 `droneLostBy` ⇒ 回落到全队合计 `droneLost`（零迁移）。
   */
  ownerTag = 'player',
  /** 虫洞逐舰收口收集本次结果；不改变扣账或普通战斗的报告写入条件。 */
  onReport?: (report: import('../state').DroneLossReport) => void,
): string | null {
  const byOwner = battle?.droneLostBy
  const lost = byOwner ? byOwner[ownerTag] : ownerTag === 'player' ? battle?.droneLost : undefined
  if (!lost) return null
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return null
  const printing = plugModulesOf(state, ctx, shipId).some(p => p.dronePrinting)
  const unit = battle?.units?.[ownerTag]
  if (printing && unit && unit.hp.h > 0) {
    // 只恢复原编制：打印复位无实物扣账，不能按复位次数生成仓库库存。
    const start = battle?.droneLoadAtStartBy?.[ownerTag] ?? (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined)
    if (start) fleetShip.droneLoad = { ...start }
    if (battle!.droneLostBy) delete battle!.droneLostBy[ownerTag]
    battle!.droneLost = battle!.droneLostBy
      ? Object.values(battle!.droneLostBy).reduce<Record<string, number>>((all, rows) => {
          for (const [id, n] of Object.entries(rows)) all[id] = (all[id] ?? 0) + n
          return all
        }, {}) : undefined
    const total = Object.values(fleetShip.droneLoad ?? {}).reduce((n, v) => n + v, 0)
    const report = { battleStartedAtGameMs: battle!.startedAtGameMs, rate: 1, total: 0, recovered: 0, gone: 0, survivors: total, rows: [] }
    if (ownerTag === 'player') state.droneLossReport = report
    onReport?.(report)
    return null
  }
  const rate = droneRecoveryRateWithBonus(state, recoveryBonus)
  const load: Record<string, number> = { ...(fleetShip.droneLoad ?? {}) }
  const supply = wormholeSupplyForBattle(state, battle)
  const startLoad = battle?.droneLoadAtStartBy?.[ownerTag] ??
    (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined) ?? load
  const revivedMap = droneRevivedOf(battle, ownerTag)
  const revivedTotal = droneRevivedCount(battle, ownerTag)

  // 新趟损坏按出发与复位实物数校验；旧趟仍以清单实有数封顶。
  type Row = { id: string; name: string; value: number; lost: number; back: number }
  const rows: Row[] = []
  let total = 0
  for (const [id, n] of Object.entries(lost)) {
    if (!n || n <= 0) continue
    const def = ctx.items.get(id)
    const cut = supply
      ? Math.min((startLoad[id] ?? 0) + (revivedMap[id] ?? 0), Math.max(0, Math.floor(n)))
      : Math.min(load[id] ?? 0, n)
    if (cut <= 0) continue
    rows.push({
      id,
      name: def?.name ?? id,
      value: def?.baseSellPriceIsk ?? 0,
      lost: cut,
      back: Math.floor(cut * rate),
    })
    total += cut
  }
  if (total <= 0) return null

  // 余数名额按价值从高到低补满，总回收数按最终整数规则向上取整，不能超过损坏数。
  let rest = Math.max(0, ceilFinalQuantity(total * rate) - rows.reduce((s, r) => s + r.back, 0))
  const byValue = [...rows].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  for (const r of byValue) {
    if (rest <= 0) break
    const room = r.lost - r.back
    if (room <= 0) continue
    const add = Math.min(room, rest)
    r.back += add
    rest -= add
  }

  if (supply) {
    settleWormholeDroneRevives(state, battle!)
    const alive: Record<string, number> = {}
    const recovered: Record<string, number> = {}
    for (const [id, n] of Object.entries(startLoad)) {
      const row = rows.find((r) => r.id === id)
      const left = Math.max(0, n + (revivedMap[id] ?? 0) - (row?.lost ?? 0))
      if (left > 0) alive[id] = left
      if ((row?.back ?? 0) > 0) recovered[id] = row!.back
    }
    const takeFrom = (stock: Record<string, number>) => (id: string): 'hold' | null => {
      if ((stock[id] ?? 0) <= 0) return null
      stock[id] = stock[id]! - 1
      return 'hold'
    }
    fleetShip.droneLoad = undefined
    refillDroneLoadTo(state, ctx, shipId, { ...alive }, takeFrom(alive))
    refillDroneLoadTo(state, ctx, shipId, startLoad, takeFrom(recovered))
    const settledLoad: Record<string, number> = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
    const survivors = Object.values(settledLoad).reduce((n, v) => n + v, 0)
    const returnedToSupply: Record<string, number> = {}
    for (const id of new Set([...Object.keys(alive), ...Object.keys(recovered)])) {
      const n = (alive[id] ?? 0) + (recovered[id] ?? 0)
      if (n <= 0) continue
      returnWormholeDroneSupply(supply, id, n)
      returnedToSupply[id] = n
    }
    const refill = refillDroneLoadTo(state, ctx, shipId, startLoad, (id) => deployWormholeSupply(supply, id, 1) === 1 ? 'hold' : null)
    battle!.droneLost = undefined
    if (battle!.droneLostBy) delete battle!.droneLostBy[ownerTag]
    if (ownerTag === 'player' || onReport) {
      const back = rows.reduce((n, r) => n + r.back, 0)
      const report: import('../state').DroneLossReport = {
        battleStartedAtGameMs: battle!.startedAtGameMs,
        rate, total, recovered: back, gone: total - back, survivors, revived: revivedTotal, returnedToSupply,
        rows: byValue.map((r) => ({ id: r.id, name: r.name, value: r.value, lost: r.lost, back: r.back, gone: r.lost - r.back })),
      }
      if (ownerTag === 'player') state.droneLossReport = report
      onReport?.(report)
    }
    const back = rows.reduce((n, r) => n + r.back, 0)
    addLog(state, 'warn', '', 'core.whExpedition.001', { p1: total, p2: back, p3: total - back })
    if (revivedTotal > 0) addLog(state, 'combat', '', 'core.whExpedition.002', { p1: revivedTotal })
    const returned = Object.values(returnedToSupply).reduce((n, v) => n + v, 0)
    if (returned > 0) addLog(state, 'combat', '', 'core.whExpedition.003', { p1: returned })
    if (Object.keys(refill.short).length > 0) addLog(state, 'warn', '', 'core.whExpedition.004')
    return byValue.map((r) => `${r.name}×${r.lost}`).join('、')
  }

  // ── ③ 落库：先扣**战中复活**的货、再扣净损失、最后按出发快照补货 ──
  /**
   * **战中复活的扣货点（唯一一处）**（**2026-09-27 船长令**）。
   *
   * 船长两条原话：
   * ① 「已经损失的无人机依旧计入战损，因为战后回收需要。**但是复活了的无人机等于已经补充了**。」
   * ② 「战斗中损失的无人机是在战斗结束后一次性扣除吧？那么**复活无人机数量的上限在战斗开始时
   *    设置一个库存的快照**可以吗」
   *
   * ⇒ 落地：
   * - 战中**只扣预算快照**（`battle.droneReviveStock`，开战那一刻拍的备用机数），**绝不写玩家库存**；
   * - **扣货全部收在本处**，顺序 = ①扣复活的 `v` 架 → ②扣净损失 → ③按出发快照补货（下面既有逻辑）；
   * - `droneLost` / `droneLostBy` **照记不回冲**（上面算回收率读的就是它，回冲会让回收率失真）
   *   ⇒ 只是把**清单纯损失**减掉战中复活的架数（那几架已经补回来了，不能再算一次损失）。
   */
  /**
   * ① **扣复活的那几架货**（本舰货舱 → 物品仓库；`takeDroneUnit` 是唯一取货口）。
   * ⚠ 可能扣不满：预算快照是**开战那一刻**拍的，若同队其它舰在本场结算前先扣过同一只仓库，
   * 到本舰时可能已空 ⇒ 记一条 warn（那几架等于白补，不静默吞掉）。
   */
  const revivedShort: string[] = []
  for (const [id, n] of Object.entries(revivedMap)) {
    if (battle?.droneRevive?.[ownerTag]?.printing) continue
    for (let i = 0; i < n; i++) {
      if (takeDroneUnit(state, shipId, id) === null) {
        revivedShort.push(`${ctx.items.get(id)?.name ?? id} 缺 ${n - i} 架`)
        break
      }
    }
  }
  let recovered = 0
  for (const r of rows) {
    const goneInBattle = Math.max(0, (revivedMap[r.id] ?? 0))
    const gone = Math.max(0, r.lost - r.back - goneInBattle)
    recovered += r.back
    if (gone > 0) {
      const left = (load[r.id] ?? 0) - gone
      if (left > 0) load[r.id] = left
      else delete load[r.id]
    }
  }
  fleetShip.droneLoad = Object.keys(load).length > 0 ? load : undefined
  /**
   * **补货前的存活架数**（船长 2026-09-20 批：本场结束立刻补足机群）——
   * 停环记账与"战损过半"判定都必须读这个数，**不能**读补货后的清单（否则安全阀永远判不出来）。
   */
  const survivors = Object.values(load).reduce((s, n) => s + n, 0)
  // 结算后清空战损账本（调用幂等：重复结算不会重复扣；战报/日志已带损失摘要）
  battle!.droneLost = undefined
  // **逐舰账本也清掉本舰那一份**（2026-09-14「按舰归属」：多舰各结算一次，清掉才能幂等）
  if (battle!.droneLostBy) {
    const rest = { ...battle!.droneLostBy }
    delete rest[ownerTag]
    battle!.droneLostBy = rest
  }
  /**
   * **立刻补足机群**（船长 2026-09-20：「战斗结束立刻自动补充，优先货仓，其次是仓库」＋「按本场出发快照补」）。
   *
   * 目标 = **本场出发时的清单快照**（多舰走 `droneLoadAtStartBy[本舰]`，主控回落 `droneLoadAtStart`），
   * 货源 = 本船货仓 → 物品仓库（`refillDroneLoadTo` 单一入口，受舱容/CPU 校验、不自动购买）。
   * ⚠ **必须在 `survivors` 之后**：停环记账与战损判定读的是补货前的架数。
   */
  const legacyStartLoad = battle?.droneLoadAtStartBy?.[ownerTag] ??
    (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined) ?? {}
  const refill = refillDroneLoadTo(state, ctx, shipId, legacyStartLoad)
  const refillRows = Object.entries(refill.added)
  const refillTxt = refillRows
    .map(([id, n]) => {
      const nm = ctx.items.get(id)?.name ?? id
      const h = refill.fromHold[id] ?? 0
      const w = refill.fromWare[id] ?? 0
      const src = h > 0 && w > 0 ? `货仓 ${h} · 仓库 ${w}` : h > 0 ? `货仓 ${h}` : `仓库 ${w}`
      return `${nm}×${n}（${src}）`
    })
    .join('、')
  const shortTxt = Object.entries(refill.short)
    .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} 缺 ${n} 架`)
    .join('、')

  // 展示口径：具名清单按价值降序（高价值在前，与"优先回收"的观感一致）
  const lostParts = byValue.map((r) => `${r.name}×${r.lost}`)
  const backParts = byValue.filter((r) => r.back > 0).map((r) => `${r.name}×${r.back}`)
  const ratePct = Math.round(rate * 100)
  const text = lostParts.join('、')
  const backTxt =
    backParts.length > 0 ? `，其中 ${backParts.join("、")} 已回收修复归队` : ''
  /**
   * **战报按舰列出**（船长 2026-09-14「战损按舰归属」）：多舰趟次里每艘舰各出一条战损日志，
   * 日志抬头点名是哪条舰（单舰/主控那条不写抬头 ⇒ 与旧文案逐字一致）。
   */
  const who =
    ownerTag === 'player' ? '' : `${state.fleet[shipId] ? shipDisplayName(state, ctx, shipId) : ownerTag}：`
  /** 「战中复活」那半句：只在真复活过时才加（没装储备甲板 ⇒ 文案与旧版**逐字一致**） */
  const revivedTxt = revivedTotal > 0 ? `，战中复活 ${revivedTotal} 架（由无人机储备甲板补回）` : ''
  addLog(
    state,
    'warn',
    `⚠ 机群战损${who ? `（${who.replace(/：$/, '')}）` : ''}：损坏 ${text}（合计 ${total} 架）${backTxt}（回收率 ${ratePct}%，优先回收高价值，净损失 ${Math.max(0, total - recovered - revivedTotal)} 架${revivedTxt}）——净损失已从无人机舱清单扣除。`,
  )
  // 立刻补足（船长 2026-09-20）：补货结果单独一行；货源不足再补一行 warn 说明缺多少
  if (refillRows.length > 0) {
    addLog(state, 'combat', `机群补充${who ? `（${who.replace(/：$/, '')}）` : ''}：${refillTxt}——本场出发时的编制已复位。`)
  }
  if (shortTxt.length > 0) {
    addLog(
      state,
      'warn',
      `⚠ 机群未能补满${who ? `（${who.replace(/：$/, '')}）` : ''}：${shortTxt}——货仓与物品仓库都没有存货了，购买或制造后再到装配页装入。`,
    )
  }
  /**
   * 复活的货**没扣满**（预算快照是开战那一刻拍的；同队别的舰先结算过同一只仓库就可能不够）——
   * 单独一条 warn，不静默吞掉。
   */
  if (revivedShort.length > 0) {
    addLog(
      state,
      'warn',
      `⚠ 无人机储备甲板的补货未能扣满${who ? `（${who.replace(/：$/, '')}）` : ''}：${revivedShort.join('、')}——` +
        `开战时的备用库存已被同队其它舰的先期结算用掉，超出的那几架按白补处理。`,
    )
  }
  state.droneLossNotice =
    recovered > 0
      ? `机群战损：损坏 ${total} 架，回收 ${recovered} 架归队（回收率 ${ratePct}%，优先回收高价值），净损失 ${Math.max(0, total - recovered - revivedTotal)} 架${revivedTxt}。${refillRows.length > 0 ? `已自动补充 ${refillTxt}。` : ''}${shortTxt.length > 0 ? `仍有 ${shortTxt}。` : ''}`
      : `机群战损：${text} 被近防炮击落、共 ${total} 架（回收率 ${ratePct}%，优先回收高价值）${revivedTotal > 0 ? `，战中复活 ${revivedTotal} 架` : ''}——已从无人机舱清单扣除。${refillRows.length > 0 ? `已自动补充 ${refillTxt}。` : ''}${shortTxt.length > 0 ? `仍有 ${shortTxt}。` : ''}`
  // 结构化结果（2026-09-11：战报弹层要显示"回收了哪些、净损失哪些"；与 battle 起手时刻配对，
  // 避免并行会话/AI 战斗的结果串场）——只在**当前驾驶船**的结算里写，AI 副船的损失不进战报
  if (state.shipId === shipId || onReport) {
    const report: import('../state').DroneLossReport = {
      battleStartedAtGameMs: battle?.startedAtGameMs ?? 0,
      rate,
      total,
      recovered,
      gone: Math.max(0, total - recovered - revivedTotal),
      survivors,
      rows: byValue.map((r) => ({
        id: r.id,
        name: r.name,
        value: r.value,
        lost: r.lost,
        back: r.back,
        // 逐型的净损失同样减掉**该型**战中复活的架数（与总账同一口径）
        gone: Math.max(0, r.lost - r.back - (revivedMap[r.id] ?? 0)),
      })),
    }
    if (state.shipId === shipId) state.droneLossReport = report
    onReport?.({ ...report, revived: revivedTotal })
  }
  return text
}

/** 战后损坏机体的回收比例（2026-09-10 船长：基础 20%，回收学满级 50%） */
/**
 * **回收率（含谜质加成）**（F3c B2 · 船长：「机群回收网」）：既有回收率 + 装置加成，
 * **夹在 100% 以内**（物理上限：回收率是比例）。单点抽出 ⇒ 用例可直接验这条口径。
 */
export function droneRecoveryRateWithBonus(state: GameState, bonus = 0): number {
  return Math.min(1, droneRecoveryRate(state) + Math.max(0, bonus))
}

export function droneRecoveryRate(state: GameState): number {
  const rate = DRONE_SKILL.recoveryBase + DRONE_SKILL.recoveryPerLevel * droneSkillLv(state, 'drone-recovery')
  return Math.min(DRONE_SKILL.recoveryMax, rate)
}
